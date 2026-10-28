import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';
import { AttachmentBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';

export interface PaymentUserInfo {
  userId: string;
  name: string;
  promptpay?: string | null;
  qrImageUrl?: string | null;
}

export interface PaymentAttachmentResult {
  attachment: AttachmentBuilder;
  imageFileName: string;
  sourceType: 'custom_qr' | 'promptpay_dynamic';
  creditorName: string;
  amount: number;
}

/**
 * Generates a dynamic PromptPay QR code as a Discord Attachment.
 * @param promptPayId Phone number (e.g. 0812345678) or National ID (13 digits)
 * @param amount Amount in THB
 * @param filename Custom filename for the attachment
 */
export async function generatePromptPayAttachment(
  promptPayId: string,
  amount: number,
  filename = 'promptpay-qr.png'
): Promise<AttachmentBuilder | null> {
  try {
    const cleanId = promptPayId.replace(/[-\s]/g, '');
    const payload = generatePayload(cleanId, { amount });
    const buffer = await QRCode.toBuffer(payload, {
      type: 'png',
      margin: 2,
      width: 300,
      color: {
        dark: '#002663', // Thai QR blue tone
        light: '#FFFFFF',
      },
    });

    return new AttachmentBuilder(buffer, { name: filename });
  } catch (err) {
    console.error('Failed to generate PromptPay QR:', err);
    return null;
  }
}

/**
 * Resolves the payment QR attachment for a creditor.
 * Priority:
 * 1. Custom uploaded QR image (bank QR or PromptPay QR uploaded by user).
 * 2. Dynamically generated PromptPay QR code (if PromptPay number is configured).
 * 3. null (if neither is available).
 */
export async function resolvePaymentAttachment(
  user: PaymentUserInfo,
  amount: number
): Promise<PaymentAttachmentResult | null> {
  // 1. Check custom uploaded QR image
  if (user.qrImageUrl) {
    try {
      const resolvedPath = path.isAbsolute(user.qrImageUrl)
        ? user.qrImageUrl
        : path.join(process.cwd(), user.qrImageUrl);

      if (fs.existsSync(resolvedPath)) {
        const ext = path.extname(resolvedPath) || '.png';
        const fileName = `payment-qr${ext}`;
        const buffer = fs.readFileSync(resolvedPath);
        return {
          attachment: new AttachmentBuilder(buffer, { name: fileName }),
          imageFileName: fileName,
          sourceType: 'custom_qr',
          creditorName: user.name,
          amount,
        };
      } else if (user.qrImageUrl.startsWith('http://') || user.qrImageUrl.startsWith('https://')) {
        const resp = await fetch(user.qrImageUrl);
        if (resp.ok) {
          const arrayBuffer = await resp.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          return {
            attachment: new AttachmentBuilder(buffer, { name: 'payment-qr.png' }),
            imageFileName: 'payment-qr.png',
            sourceType: 'custom_qr',
            creditorName: user.name,
            amount,
          };
        }
      }
    } catch (err) {
      console.error(`Failed to load custom QR image for user ${user.userId}:`, err);
    }
  }

  // 2. Fallback to PromptPay number (generate dynamic QR with exact amount)
  if (user.promptpay) {
    const attachment = await generatePromptPayAttachment(user.promptpay, amount, 'promptpay-qr.png');
    if (attachment) {
      return {
        attachment,
        imageFileName: 'promptpay-qr.png',
        sourceType: 'promptpay_dynamic',
        creditorName: user.name,
        amount,
      };
    }
  }

  return null;
}
