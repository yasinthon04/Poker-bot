export interface ParsedPlayerItem {
  rawIdentifier: string;
  userId?: string;
  name: string;
  buyIn: number;
  cashOut: number;
}

export interface ParseResult {
  players: ParsedPlayerItem[];
  errors: string[];
}

/**
 * Parses user-typed manual settlement strings.
 * Supports flexible multi-line and comma-separated formats:
 * - @Ton 350
 * - <@123456789> 350
 * - @Nadear 50 buyin:400
 * - JJ 200 (buyin 300)
 * - Charlie 350/200
 * - Bob -150 (signed net profit/loss)
 * - Alice +250
 * - Ton: cashout 350, buyin 200
 */
export function parseManualInputLines(
  rawText: string,
  defaultBuyIn: number = 200
): ParseResult {
  const players: ParsedPlayerItem[] = [];
  const errors: string[] = [];

  if (!rawText || !rawText.trim()) {
    errors.push('ข้อความว่างเปล่า กรุณากรอกรายชื่อผู้เล่นและยอดเงิน');
    return { players, errors };
  }

  // 1. Break into raw lines / chunks by newline or semicolon
  const rawChunks = rawText
    .split(/[\n;]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // 2. Expand chunks if a single line contains comma-separated entries with different players
  const entryStrings: string[] = [];
  for (const chunk of rawChunks) {
    // If the chunk has multiple @ mentions, split before each mention
    const mentionCount = (chunk.match(/<@!?\d+>|(?<=^|\s)@[a-zA-Z0-9ก-๙_]+/g) || []).length;
    if (mentionCount > 1) {
      const parts = chunk.split(/(?=<@!?\d+>|(?<=^|\s)@[a-zA-Z0-9ก-๙_]+)/g);
      for (const p of parts) {
        const trimmed = p.replace(/^[,\s]+|[,\s]+$/g, '').trim();
        if (trimmed) entryStrings.push(trimmed);
      }
    } else if (chunk.includes(',') && !chunk.toLowerCase().includes('buyin') && !chunk.toLowerCase().includes('cashout')) {
      // Simple comma-separated list like "Ton 350, Nadear 50, JJ 200"
      const parts = chunk.split(',');
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed) entryStrings.push(trimmed);
      }
    } else {
      entryStrings.push(chunk);
    }
  }

  for (const rawEntry of entryStrings) {
    let working = rawEntry.trim();
    if (!working) continue;

    let userId: string | undefined;
    let explicitBuyIn: number | undefined;
    let explicitCashOut: number | undefined;
    let netProfit: number | undefined;

    // A. Check for Discord user mention <@123456789>
    const mentionMatch = working.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      userId = mentionMatch[1];
      working = working.replace(mentionMatch[0], ' ');
    }

    // B. Check for explicit buy-in: e.g. "buyin: 400", "buyin 400", "ทุน 400", "บายอิน 400"
    const buyinMatch = working.match(/(?:buyin|buy-in|buy_in|บายอิน|ซื้อ|ทุน|บักอิน)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (buyinMatch) {
      explicitBuyIn = parseFloat(buyinMatch[1]);
      working = working.replace(buyinMatch[0], ' ');
    }

    // C. Check for explicit cashout / chips: e.g. "cashout: 350", "ชิป 350", "เหลือ 350"
    const cashoutMatch = working.match(/(?:cashout|cash-out|cash_out|chips|ชิป|ยอด|เหลือ|ถอน)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (cashoutMatch) {
      explicitCashOut = parseFloat(cashoutMatch[1]);
      working = working.replace(cashoutMatch[0], ' ');
    }

    // D. Check for slash pattern: "350/200" (cashout / buyin)
    const slashMatch = working.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (slashMatch && explicitCashOut === undefined && explicitBuyIn === undefined) {
      explicitCashOut = parseFloat(slashMatch[1]);
      explicitBuyIn = parseFloat(slashMatch[2]);
      working = working.replace(slashMatch[0], ' ');
    }

    // E. Check for parenthesis pattern: "350 (400)" or "350(200)"
    const parenMatch = working.match(/(\d+(?:\.\d+)?)\s*\(\s*(?:buyin:?\s*)?(\d+(?:\.\d+)?)\s*\)/i);
    if (parenMatch && explicitCashOut === undefined && explicitBuyIn === undefined) {
      explicitCashOut = parseFloat(parenMatch[1]);
      explicitBuyIn = parseFloat(parenMatch[2]);
      working = working.replace(parenMatch[0], ' ');
    }

    // F. Check for signed net profit (+150 or -150)
    const signedMatch = working.match(/(?:^|\s)([+-]\d+(?:\.\d+)?)(?:\s|$|฿|บาท)/);
    if (signedMatch && explicitCashOut === undefined) {
      netProfit = parseFloat(signedMatch[1]);
      working = working.replace(signedMatch[1], ' ');
    }

    // G. Any remaining standalone numbers
    const remainingNumbers = working.match(/\b\d+(?:\.\d+)?\b/g);

    let finalBuyIn = explicitBuyIn;
    let finalCashOut = explicitCashOut;

    if (netProfit !== undefined) {
      finalBuyIn = finalBuyIn ?? defaultBuyIn;
      finalCashOut = Math.max(0, finalBuyIn + netProfit);
    } else if (finalCashOut === undefined) {
      if (remainingNumbers && remainingNumbers.length >= 2) {
        finalCashOut = parseFloat(remainingNumbers[0]);
        if (finalBuyIn === undefined) {
          finalBuyIn = parseFloat(remainingNumbers[1]);
        }
      } else if (remainingNumbers && remainingNumbers.length === 1) {
        finalCashOut = parseFloat(remainingNumbers[0]);
        finalBuyIn = finalBuyIn ?? defaultBuyIn;
      }
    } else if (finalBuyIn === undefined) {
      if (remainingNumbers && remainingNumbers.length >= 1) {
        finalBuyIn = parseFloat(remainingNumbers[0]);
      } else {
        finalBuyIn = defaultBuyIn;
      }
    }

    if (finalBuyIn === undefined) finalBuyIn = defaultBuyIn;

    // H. Extract Player Name from whatever text is left
    // Remove symbols, currency marks, colons, dashes
    let cleanName = working
      .replace(/[0-9.,:;=+\-฿\/()\[\]]/g, ' ')
      .replace(/^@+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanName && userId) {
      cleanName = `User_${userId.slice(-4)}`;
    }

    if (!cleanName && finalCashOut === undefined) {
      continue;
    }

    if (finalCashOut === undefined) {
      errors.push(`⚠️ ไม่พบยอดชิป/เงินของ: "${rawEntry}"`);
      continue;
    }

    if (!cleanName) {
      cleanName = `Player_${players.length + 1}`;
    }

    players.push({
      rawIdentifier: rawEntry,
      userId,
      name: cleanName,
      buyIn: Math.round(finalBuyIn * 100) / 100,
      cashOut: Math.round(finalCashOut * 100) / 100,
    });
  }

  if (players.length === 0 && errors.length === 0) {
    errors.push('ไม่พบรายชื่อผู้เล่นที่ถูกต้อง กรุณาตรวจสอบรูปแบบข้อความ (เช่น @Ton 350, @Nadear 50)');
  }

  return { players, errors };
}

/**
 * Resolves parsed players to Discord GuildMembers (if available) or creates clean user records.
 * Also combines duplicate players if someone was listed twice in the input.
 */
export async function resolvePlayerDiscordMembers(
  parsedList: ParsedPlayerItem[],
  guild?: any,
  voiceChannelId?: string
): Promise<{ userId: string; name: string; buyIn: number; cashOut: number }[]> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');
  const resolvedList: { userId: string; name: string; buyIn: number; cashOut: number }[] = [];

  // Build candidate members from Voice channel & Guild cache
  const candidateMembers = new Map<string, { id: string; username: string; displayName: string }>();

  if (guild) {
    // 1. Members in voice channel if available
    if (voiceChannelId && guild.voiceStates?.cache) {
      const vsList = guild.voiceStates.cache.filter((vs: any) => vs.channelId === voiceChannelId);
      for (const [mId, vs] of vsList) {
        const m = vs.member;
        if (m && !m.user?.bot) {
          candidateMembers.set(m.id, {
            id: m.id,
            username: m.user.username,
            displayName: m.displayName || m.user.username,
          });
        }
      }
    }

    // 2. Cached members in guild
    if (guild.members?.cache) {
      for (const [, m] of guild.members.cache) {
        if (!m.user?.bot && !candidateMembers.has(m.id)) {
          candidateMembers.set(m.id, {
            id: m.id,
            username: m.user.username,
            displayName: m.displayName || m.user.username,
          });
        }
      }
    }
  }

  for (const item of parsedList) {
    let finalUserId: string | undefined = item.userId;
    let finalName: string = item.name;

    // If userId is already an explicit snowflake mention:
    if (finalUserId) {
      if (guild && typeof guild.members?.fetch === 'function') {
        try {
          const m = await guild.members.fetch(finalUserId).catch(() => null);
          if (m) {
            finalName = m.displayName || m.user?.username || finalName;
          }
        } catch {}
      }
    } else if (guild) {
      // Try to match name with candidate members
      const targetNorm = norm(item.name);
      if (targetNorm) {
        let matched = Array.from(candidateMembers.values()).find(cm => {
          const uNorm = norm(cm.username);
          const dNorm = norm(cm.displayName);
          return (
            targetNorm === uNorm ||
            targetNorm === dNorm ||
            (targetNorm.length >= 3 && (uNorm.includes(targetNorm) || dNorm.includes(targetNorm)))
          );
        });

        if (!matched && typeof guild.members?.search === 'function') {
          try {
            const searched = await guild.members.search({ query: item.name, limit: 1 });
            const found = searched.first();
            if (found && !found.user?.bot) {
              matched = {
                id: found.id,
                username: found.user.username,
                displayName: found.displayName,
              };
            }
          } catch {}
        }

        if (matched) {
          finalUserId = matched.id;
          finalName = matched.displayName;
        }
      }
    }

    if (!finalUserId) {
      const cleanNorm = norm(finalName);
      finalUserId = `guest_${cleanNorm || Math.random().toString(36).substring(2, 7)}`;
    }

    // Aggregate with existing if duplicate
    const existing = resolvedList.find(r => r.userId === finalUserId);
    if (existing) {
      existing.buyIn = Math.round((existing.buyIn + item.buyIn) * 100) / 100;
      existing.cashOut = Math.round((existing.cashOut + item.cashOut) * 100) / 100;
    } else {
      resolvedList.push({
        userId: finalUserId,
        name: finalName,
        buyIn: item.buyIn,
        cashOut: item.cashOut,
      });
    }
  }

  return resolvedList;
}

/**
 * Formats a session's players back into editable text format for pre-filling edit modals.
 */
export function formatPlayersForModal(
  defaultBuyIn: number,
  players: { user_id: string; username: string; display_name: string | null; buy_in: number; cash_out: number | null }[]
): string {
  return players
    .map(p => {
      const isSnowflake = /^\d+$/.test(p.user_id);
      const tag = isSnowflake ? `<@${p.user_id}>` : p.display_name || p.username;
      const cash = p.cash_out ?? 0;
      if (p.buy_in !== defaultBuyIn) {
        return `${tag} ${cash} buyin:${p.buy_in}`;
      }
      return `${tag} ${cash}`;
    })
    .join('\n');
}
