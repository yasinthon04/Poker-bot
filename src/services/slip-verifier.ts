import { GoogleGenAI } from '@google/genai';
import { isTransRefUsed, SettlementRow } from '../database/repo';

export interface SlipData {
  isBankSlip: boolean;
  bankName?: string;
  transAmount?: number;
  transDate?: string;
  transTime?: string;
  transRef?: string;
  senderName?: string;
  recipientName?: string;
  recipientPromptPay?: string;
  recipientAccount?: string;
}

export interface SlipVerificationResult {
  success: boolean;
  isSlip: boolean;
  reason: string;
  data?: SlipData;
}

let mockSlipVerifier: ((imageUrl: string, expectedAmount: number) => Promise<SlipVerificationResult>) | null = null;

export function setMockSlipVerifier(fn: ((imageUrl: string, expectedAmount: number) => Promise<SlipVerificationResult>) | null) {
  mockSlipVerifier = fn;
}

/**
 * Normalizes Thai PromptPay number or account number by stripping dashes, spaces, and leading zeros
 */
function cleanDigits(str?: string | null): string {
  if (!str) return '';
  return str.replace(/\D/g, '');
}

/**
 * Checks if slip recipient PromptPay matches expected PromptPay (supports masked like xxx-xxx-1234)
 */
function isPromptPayMatch(slipPromptPay?: string, expectedPromptPay?: string): boolean {
  if (!slipPromptPay || !expectedPromptPay) return false;
  const cleanExpected = cleanDigits(expectedPromptPay);
  const cleanSlip = cleanDigits(slipPromptPay);
  if (!cleanExpected || !cleanSlip) return false;

  // Exact match
  if (cleanExpected === cleanSlip) return true;

  // Masked match: check if the visible last 4 digits match
  if (cleanExpected.length >= 4 && cleanSlip.length >= 4) {
    const expectedTail = cleanExpected.slice(-4);
    const slipTail = cleanSlip.slice(-4);
    if (expectedTail === slipTail) return true;
  }

  return false;
}

/**
 * Checks if recipient name on slip loosely matches expected name
 */
function isNameMatch(slipName?: string, expectedName?: string): boolean {
  if (!slipName || !expectedName) return false;
  const s = slipName.toLowerCase().replace(/นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.|mrs\.|ms\./gi, '').replace(/\s+/g, '').trim();
  const e = expectedName.toLowerCase().replace(/นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.|mrs\.|ms\./gi, '').replace(/\s+/g, '').trim();
  if (s.length === 0 || e.length === 0) return false;
  return s.includes(e) || e.includes(s);
}

/**
 * Extract bank slip details using Gemini Vision AI
 */
export async function extractSlipData(imageUrl: string): Promise<SlipData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in .env');
  }

  // 1. Download image
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`ไม่สามารถดาวน์โหลดรูปภาพได้ (${response.statusText})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = response.headers.get('content-type') || 'image/png';

  // 2. Call Gemini Vision
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `
You are an expert Thai banking slip verification assistant.
Analyze this image and determine if it is an authentic Thai bank transfer slip (e.g., KBank K PLUS, SCB EASY, Krungthai NEXT, Bangkok Bank Bualuang, ttb touch, GSB Mymo, TrueMoney, PromptPay, etc.).

Extract the following information:
1. "isBankSlip": boolean (true if this is a genuine bank transfer receipt/slip, false if it's a random image, meme, photo, or not a transfer slip)
2. "bankName": string (e.g. "KBANK", "SCB", "KTB", "BBL", "TTB", "GSB", "TrueMoney", "PromptPay", or null)
3. "transAmount": number (exact amount transferred in THB, e.g. 200.00, or null)
4. "transDate": string (e.g. "2026-10-30" or Thai date, or null)
5. "transTime": string (e.g. "18:25" or null)
6. "transRef": string (transaction reference number / รหัสอ้างอิง, or null)
7. "senderName": string (name of sender on slip, e.g. "นาย ธนภัทร สุขใจ", or null)
8. "recipientName": string (name of recipient on slip, e.g. "นาย สมชาย ใจดี", or null)
9. "recipientPromptPay": string (PromptPay number or phone number of recipient if shown, e.g. "089-xxx-5678", or null)
10. "recipientAccount": string (recipient account number if shown, or null)

Return ONLY a valid JSON object matching this structure:
{
  "isBankSlip": true,
  "bankName": "KBANK",
  "transAmount": 200.0,
  "transDate": "2026-10-30",
  "transTime": "18:25:10",
  "transRef": "2026103012345678",
  "senderName": "นาย ธนภัทร สุขใจ",
  "recipientName": "นาย สมชาย ใจดี",
  "recipientPromptPay": "089-xxx-5678",
  "recipientAccount": "xxx-x-x1234-x"
}
`;

  const modelsToTry = [
    process.env.GEMINI_MODEL,
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-flash-latest',
  ].filter(Boolean) as string[];

  let parsed: SlipData | null = null;
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    try {
      let timeoutId: any;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timeout after 12000ms on ${modelName}`)), 12000);
      });

      const generatePromise = ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType.split(';')[0],
                },
              },
            ],
          },
        ],
        config: {
          maxOutputTokens: 600,
          responseMimeType: 'application/json',
        },
      });

      const result: any = await Promise.race([generatePromise, timeoutPromise]).finally(() =>
        clearTimeout(timeoutId)
      );

      if (result && result.text) {
        parsed = JSON.parse(result.text.trim()) as SlipData;
        break;
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`Slip verify model ${modelName} failed:`, err.message || err);
    }
  }

  if (!parsed) {
    throw new Error(lastError?.message || 'AI ไม่สามารถประมวลผลรูปได้');
  }

  return parsed;
}

/**
 * Verifies and automatically matches a bank transfer slip against a list of pending debts
 */
export async function verifyAndMatchSlip(
  imageUrl: string,
  pendingDebts: SettlementRow[]
): Promise<SlipVerificationResult & { matchedDebt?: SettlementRow }> {
  let parsed: SlipData;
  if (mockSlipVerifier) {
    const expected = pendingDebts[0]?.amount || 0;
    const res = await mockSlipVerifier(imageUrl, expected);
    if (!res.isSlip || !res.data) {
      return {
        ...res,
        matchedDebt: pendingDebts[0],
      };
    }
    parsed = res.data;
  } else {
    try {
      parsed = await extractSlipData(imageUrl);
    } catch (err: any) {
      return {
        success: false,
        isSlip: false,
        reason: `เกิดข้อผิดพลาดในการวิเคราะห์สลิป: ${err.message || 'AI ไม่สามารถประมวลผลรูปได้'}`,
      };
    }
  }

  if (!parsed.isBankSlip || parsed.transAmount === undefined || parsed.transAmount === null) {
    return {
      success: false,
      isSlip: false,
      reason: 'รูปภาพนี้ไม่ใช่สลิปโอนเงินของธนาคาร',
      data: parsed,
    };
  }

  // Duplicate Trans Ref check
  if (parsed.transRef) {
    const isUsed = await isTransRefUsed(parsed.transRef);
    if (isUsed) {
      return {
        success: false,
        isSlip: true,
        reason: `⚠️ สลิปนี้ (เลขอ้างอิง \`${parsed.transRef}\`) เคยถูกส่งในระบบไปแล้ว! ป้องกันการส่งสลิปซ้ำ`,
        data: parsed,
      };
    }
  }

  if (pendingDebts.length === 0) {
    return {
      success: false,
      isSlip: true,
      reason: 'ไม่พบรายการหนี้ค้างชำระของคุณในระบบครับ',
      data: parsed,
    };
  }

  // Match best debt from pending debts
  let bestDebt: SettlementRow | null = null;
  const amountMatches = pendingDebts.filter(d => Math.abs(d.amount - (parsed.transAmount || 0)) <= 0.5);

  if (amountMatches.length === 1) {
    bestDebt = amountMatches[0];
  } else if (amountMatches.length > 1) {
    // If multiple debts have the exact same amount, try matching recipient
    bestDebt =
      amountMatches.find(d => {
        const pp = isPromptPayMatch(parsed.recipientPromptPay, d.to_promptpay || undefined);
        const name = isNameMatch(parsed.recipientName, d.to_bank_name || d.to_name);
        return pp || name;
      }) || amountMatches[0];
  } else {
    // No exact amount match. Check if slip amount is >= some debt amount
    const partialMatches = pendingDebts.filter(d => (parsed.transAmount || 0) >= d.amount);
    if (partialMatches.length > 0) {
      bestDebt = partialMatches[0];
    } else {
      bestDebt = pendingDebts[0];
    }
  }

  // Validate against the chosen debt
  const amountDiff = (parsed.transAmount || 0) - bestDebt.amount;
  if (amountDiff < -0.5) {
    const pendingListStr = pendingDebts.map(d => `${d.amount.toLocaleString()}฿ ให้ <@${d.to_user_id}>`).join(', ');
    return {
      success: false,
      isSlip: true,
      reason: `ยอดเงินในสลิป (**${parsed.transAmount.toLocaleString()}฿**) น้อยกว่ายอดหนี้ที่ต้องชำระ (**${bestDebt.amount.toLocaleString()}฿**)\n*(รายการหนี้ที่ค้าง: ${pendingListStr})*`,
      data: parsed,
      matchedDebt: bestDebt,
    };
  }

  // Check Recipient match if creditor has configured promptpay or bank_name
  if (bestDebt.to_promptpay || bestDebt.to_bank_name) {
    const ppMatch = isPromptPayMatch(parsed.recipientPromptPay, bestDebt.to_promptpay || undefined);
    const nameMatch = isNameMatch(parsed.recipientName, bestDebt.to_bank_name || undefined);

    if (parsed.recipientPromptPay || parsed.recipientName) {
      if (!ppMatch && !nameMatch) {
        return {
          success: false,
          isSlip: true,
          reason: `ปลายทางในสลิป (${parsed.recipientName || parsed.recipientPromptPay || 'ไม่ระบุ'}) ไม่ตรงกับเจ้าหนี้ <@${bestDebt.to_user_id}> (${bestDebt.to_bank_name || bestDebt.to_promptpay})`,
          data: parsed,
          matchedDebt: bestDebt,
        };
      }
    }
  }

  return {
    success: true,
    isSlip: true,
    reason: `สลิปถูกต้อง โอนสำเร็จจำนวน **${parsed.transAmount.toLocaleString()} บาท** ให้ <@${bestDebt.to_user_id}>`,
    data: parsed,
    matchedDebt: bestDebt,
  };
}

/**
 * Verifies a bank transfer slip image against a specific expected amount and recipient
 */
export async function verifyBankSlip(
  imageUrl: string,
  expectedAmount: number,
  expectedRecipientPromptPay?: string | null,
  expectedRecipientName?: string | null,
  expectedSenderRealName?: string | null
): Promise<SlipVerificationResult> {
  const mockDebt: any = {
    id: 0,
    session_id: 0,
    from_user_id: '',
    to_user_id: '',
    amount: expectedAmount,
    status: 'pending',
    to_promptpay: expectedRecipientPromptPay,
    to_bank_name: expectedRecipientName,
    to_name: expectedRecipientName,
  };
  return await verifyAndMatchSlip(imageUrl, [mockDebt]);
}
