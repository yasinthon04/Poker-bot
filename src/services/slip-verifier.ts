import { GoogleGenAI } from '@google/genai';
import { isTransRefUsed } from '../database/repo';

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
  const s = slipName.toLowerCase().replace(/นาย|นางสาว|นาง|mr\.|mrs\.|ms\./gi, '').trim();
  const e = expectedName.toLowerCase().replace(/นาย|นางสาว|นาง|mr\.|mrs\.|ms\./gi, '').trim();
  if (s.length === 0 || e.length === 0) return false;
  return s.includes(e) || e.includes(s);
}

/**
 * Verifies a bank transfer slip image using Gemini Vision AI
 */
export async function verifyBankSlip(
  imageUrl: string,
  expectedAmount: number,
  expectedRecipientPromptPay?: string | null,
  expectedRecipientName?: string | null,
  expectedSenderRealName?: string | null
): Promise<SlipVerificationResult> {
  if (mockSlipVerifier) {
    return await mockSlipVerifier(imageUrl, expectedAmount);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in .env');
  }

  // 1. Download image
  const response = await fetch(imageUrl);
  if (!response.ok) {
    return {
      success: false,
      isSlip: false,
      reason: `ไม่สามารถดาวน์โหลดรูปภาพได้ (${response.statusText})`,
    };
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
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
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
    return {
      success: false,
      isSlip: false,
      reason: `เกิดข้อผิดพลาดในการวิเคราะห์สลิป: ${lastError?.message || 'AI ไม่สามารถประมวลผลรูปได้'}`,
    };
  }

  // 3. Validation Logic
  if (!parsed.isBankSlip || parsed.transAmount === undefined || parsed.transAmount === null) {
    return {
      success: false,
      isSlip: false,
      reason: 'รูปภาพนี้ไม่ใช่สลิปโอนเงินของธนาคาร',
      data: parsed,
    };
  }

  // Check Amount (Allow float precision variance within 0.5 THB)
  const amountDiff = parsed.transAmount - expectedAmount;
  if (amountDiff < -0.5) {
    return {
      success: false,
      isSlip: true,
      reason: `ยอดเงินในสลิป (**${parsed.transAmount.toLocaleString()}฿**) น้อยกว่ายอดหนี้ที่ต้องชำระ (**${expectedAmount.toLocaleString()}฿**)`,
      data: parsed,
    };
  }

  // Check Trans Ref (Duplicate protection)
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

  // Check Recipient (PromptPay or Name matching)
  if (expectedRecipientPromptPay || expectedRecipientName) {
    const ppMatch = isPromptPayMatch(parsed.recipientPromptPay, expectedRecipientPromptPay || undefined);
    const nameMatch = isNameMatch(parsed.recipientName, expectedRecipientName || undefined);

    // If both promptpay and name are present on slip, at least one should match
    if (parsed.recipientPromptPay || parsed.recipientName) {
      if (!ppMatch && !nameMatch) {
        return {
          success: false,
          isSlip: true,
          reason: `ปลายทางในสลิป (${parsed.recipientName || parsed.recipientPromptPay || 'ไม่ระบุ'}) ไม่ตรงกับเจ้าหนี้ (${expectedRecipientName || expectedRecipientPromptPay})`,
          data: parsed,
        };
      }
    }
  }

  return {
    success: true,
    isSlip: true,
    reason: `สลิปถูกต้อง โอนสำเร็จจำนวน **${parsed.transAmount.toLocaleString()} บาท**`,
    data: parsed,
  };
}
