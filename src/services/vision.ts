import { GoogleGenAI } from '@google/genai';

export interface DetectedPlayer {
  name: string;
  chips: number;
}

let mockParser: ((imageUrl: string) => Promise<DetectedPlayer[]>) | null = null;

export function setMockPokerScreenshotParser(fn: ((imageUrl: string) => Promise<DetectedPlayer[]>) | null) {
  mockParser = fn;
}

export async function parsePokerScreenshot(imageUrl: string): Promise<DetectedPlayer[]> {
  if (mockParser) {
    return await mockParser(imageUrl);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in .env');
  }

  // 1. Download image
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = response.headers.get('content-type') || 'image/png';

  // 2. Call Gemini Vision API
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `
Look at this poker game table screenshot (often from Discord Poker Night Activity or online poker).
Extract all player names and their final chip amounts / stacks (chips are usually shown as numbers or with $ next to or below their name/avatar).
Ignore the POT in the middle. Focus only on the players around the table.

Return ONLY a valid JSON array of objects with "name" (string) and "chips" (number, integer or float).
Example:
[
  {"name": "TON", "chips": 215},
  {"name": "JJ.", "chips": 310},
  {"name": "NADEAR", "chips": 155},
  {"name": "GAMGAM", "chips": 215},
  {"name": "CHII", "chips": 105}
]
`;

  const modelsToTry = [
    process.env.GEMINI_MODEL,
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
  ].filter(Boolean) as string[];

  let result: any = null;
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    try {
      // 10-second timeout per model to prevent hanging on overloaded models
      let timeoutId: any;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timeout after 10000ms on ${modelName}`)), 10000);
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
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
        },
      });

      result = await Promise.race([generatePromise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
      if (result) break;
    } catch (err: any) {
      lastError = err;
      console.warn(`Model ${modelName} failed or timed out, trying next:`, err.message || err);
    }
  }

  if (!result) {
    throw lastError || new Error('All Gemini models failed to generate content');
  }

  const responseText = result.text || '';

  // 3. Clean and parse JSON
  let parsed: DetectedPlayer[] = [];
  try {
    parsed = JSON.parse(responseText.trim());
  } catch {
    const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) {
      throw new Error('Could not parse player chips from image. AI response: ' + responseText);
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  return parsed.map(p => ({
    name: String(p.name).replace(/^@/, '').trim(),
    chips: typeof p.chips === 'number' ? p.chips : parseFloat(String(p.chips).replace(/[^0-9.]/g, '')) || 0,
  }));
}

/**
 * Matches detected player names with active table players in Discord.
 */
export function matchPlayersWithDiscord(
  detected: DetectedPlayer[],
  sessionPlayers: { user_id: string; username: string; display_name: string | null }[]
): {
  matched: { userId: string; discordName: string; detectedName: string; chips: number }[];
  unmatchedDetected: DetectedPlayer[];
  unmatchedDiscord: { userId: string; name: string }[];
} {
  const matched: { userId: string; discordName: string; detectedName: string; chips: number }[] = [];
  const matchedUserIds = new Set<string>();
  const matchedDetectedNames = new Set<string>();

  // Normalize string for comparison (lowercase, remove dots, spaces, special chars)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');

  for (const d of detected) {
    const dNorm = norm(d.name);
    // Find best match among Discord players
    const match = sessionPlayers.find(sp => {
      if (matchedUserIds.has(sp.user_id)) return false;
      const uNorm = norm(sp.username);
      const dispNorm = norm(sp.display_name || '');

      return (
        dNorm === uNorm ||
        dNorm === dispNorm ||
        (dNorm.length >= 3 && (uNorm.includes(dNorm) || dispNorm.includes(dNorm))) ||
        (uNorm.length >= 3 && dNorm.includes(uNorm)) ||
        (dispNorm.length >= 3 && dNorm.includes(dispNorm))
      );
    });

    if (match) {
      matched.push({
        userId: match.user_id,
        discordName: match.display_name || match.username,
        detectedName: d.name,
        chips: d.chips,
      });
      matchedUserIds.add(match.user_id);
      matchedDetectedNames.add(d.name);
    }
  }

  const unmatchedDetected = detected.filter(d => !matchedDetectedNames.has(d.name));
  const unmatchedDiscord = sessionPlayers
    .filter(sp => !matchedUserIds.has(sp.user_id))
    .map(sp => ({ userId: sp.user_id, name: sp.display_name || sp.username }));

  return { matched, unmatchedDetected, unmatchedDiscord };
}
