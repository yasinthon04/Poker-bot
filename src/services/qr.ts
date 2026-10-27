import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';
import { AttachmentBuilder } from 'discord.js';

/**
 * Generates a PromptPay QR code as a Discord Attachment.
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
