import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { PokerTable, TablePlayer } from './poker-table';
import { calculateSettlements } from '../services/settlement';
import { createSummaryEmbed } from '../ui/embeds';
import { resolvePaymentAttachment } from '../services/qr';
import * as repo from '../database/repo';
import { Client, TextChannel } from 'discord.js';

interface ClientConnection {
  ws: WebSocket;
  channelId?: string;
  userId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export class PokerGameManager {
  private static instance: PokerGameManager;
  public tables = new Map<string, PokerTable>();
  private clients = new Set<ClientConnection>();
  private discordClient?: Client;

  public static getInstance(): PokerGameManager {
    if (!PokerGameManager.instance) {
      PokerGameManager.instance = new PokerGameManager();
    }
    return PokerGameManager.instance;
  }

  public setDiscordClient(client: Client) {
    this.discordClient = client;
  }

  public getOrCreateTable(
    channelId: string,
    hostId: string,
    buyIn: number = 100
  ): PokerTable {
    let table = this.tables.get(channelId);
    if (!table) {
      table = new PokerTable(channelId, channelId, hostId, buyIn);
      this.tables.set(channelId, table);

      // Broadcast changes to all connected clients in this channel
      table.onStateChanged = () => {
        this.broadcastTableState(channelId);
      };

      const currentTable = table;
      // When a hand finishes, send log to Discord channel if available
      currentTable.onHandFinished = async summary => {
        if (!this.discordClient) return;
        try {
          const channel = (await this.discordClient.channels.fetch(channelId)) as TextChannel;
          if (channel && channel.isTextBased()) {
            const winnerText = summary.winners
              .map(w => `👑 **${w.name}** ชนะ **${w.potAmount.toLocaleString()}฿** (${w.handDescription})`)
              .join(', ');
            const botTag = summary.hasBots ? ' *(โหมดมี Bot - ไม่คิดเงินจริง)*' : '';
            await channel.send(`🃏 **จบแฮนด์ #${currentTable.handNumber}**${botTag}: ${winnerText}`);
          }
        } catch (e) {
          console.warn('Could not post hand summary to Discord channel:', e);
        }
      };
    }
    return table;
  }

  public attachToHttpServer(server: http.Server) {
    const wss = new WebSocketServer({ server, path: '/ws/poker' });

    wss.on('connection', ws => {
      const conn: ClientConnection = { ws };
      this.clients.add(conn);

      ws.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleClientMessage(conn, msg);
        } catch (err) {
          console.error('Error handling poker ws message:', err);
        }
      });

      ws.on('close', () => {
        this.clients.delete(conn);
        if (conn.channelId && conn.userId) {
          const table = this.tables.get(conn.channelId);
          if (table) {
            const player = table.seats.find(p => p?.userId === conn.userId);
            if (player) {
              player.connected = false;
              table.onStateChanged?.();
            }
          }
        }
      });
    });

    console.log('🎮 Poker WebSocket Server attached on path /ws/poker');
  }

  private handleClientMessage(conn: ClientConnection, msg: any) {
    const { type } = msg;

    switch (type) {
      case 'join_table': {
        const { channelId, hostId, buyIn, user } = msg;
        conn.channelId = channelId;
        conn.userId = user.id;
        conn.username = user.username;
        conn.displayName = user.displayName || user.username;
        conn.avatarUrl = user.avatarUrl;

        const table = this.getOrCreateTable(channelId, hostId || user.id, buyIn || 100);

        // Mark existing seated player as reconnected
        const seated = table.seats.find(p => p?.userId === user.id);
        if (seated) {
          seated.connected = true;
          seated.avatarUrl = user.avatarUrl || seated.avatarUrl;
        }

        this.sendStateToClient(conn, table);
        break;
      }

      case 'sit_down': {
        if (!conn.channelId || !conn.userId) return;
        const table = this.tables.get(conn.channelId);
        if (!table) return;

        const { seatIndex, buyIn } = msg;
        const success = table.sitDown(
          seatIndex,
          {
            id: conn.userId,
            username: conn.username || 'Player',
            displayName: conn.displayName || 'Player',
            avatarUrl: conn.avatarUrl,
          },
          buyIn || 100
        );

        if (!success) {
          conn.ws.send(JSON.stringify({ type: 'error', message: 'ไม่สามารถนั่งที่นั่งนี้ได้' }));
        }
        break;
      }

      case 'add_bot': {
        if (!conn.channelId) return;
        const table = this.tables.get(conn.channelId);
        if (!table) return;

        const { seatIndex, name, difficulty, chips } = msg;
        table.addBot(seatIndex, name || 'Bot Alpha', difficulty || 'medium', chips || 200);
        break;
      }

      case 'remove_bot': {
        if (!conn.channelId) return;
        const table = this.tables.get(conn.channelId);
        if (!table) return;

        const { seatIndex } = msg;
        table.removeBot(seatIndex);
        break;
      }

      case 'action': {
        if (!conn.channelId || !conn.userId) return;
        const table = this.tables.get(conn.channelId);
        if (!table) return;

        const { action, amount } = msg;
        table.handleAction(conn.userId, action, amount);
        break;
      }

      case 'rebuy': {
        if (!conn.channelId || !conn.userId) return;
        const table = this.tables.get(conn.channelId);
        if (!table) return;

        const { amount } = msg;
        table.rebuy(conn.userId, amount || 100);
        break;
      }

      case 'stand_up': {
        if (!conn.channelId || !conn.userId) return;
        const table = this.tables.get(conn.channelId);
        if (!table) return;

        table.standUp(conn.userId);
        break;
      }

      case 'settle_and_close': {
        if (!conn.channelId) return;
        this.settleAndCloseTable(conn.channelId, conn.userId);
        break;
      }
    }
  }

  public broadcastTableState(channelId: string) {
    const table = this.tables.get(channelId);
    if (!table) return;

    for (const conn of this.clients) {
      if (conn.channelId === channelId && conn.ws.readyState === WebSocket.OPEN) {
        this.sendStateToClient(conn, table);
      }
    }
  }

  private sendStateToClient(conn: ClientConnection, table: PokerTable) {
    const state = table.getPublicState(conn.userId);
    conn.ws.send(JSON.stringify({ type: 'table_state', state }));
  }

  /**
   * Finalizes table session and calculates settlement with bot exclusion!
   */
  public async settleAndCloseTable(channelId: string, requestedByUserId?: string) {
    const table = this.tables.get(channelId);
    if (!table) return;

    const seatedPlayers = table.seats.filter((p): p is TablePlayer => p !== null);
    if (seatedPlayers.length === 0) return;

    const playerInputs = seatedPlayers.map(p => ({
      userId: p.userId,
      name: p.displayName,
      buyIn: p.totalBuyIn,
      cashOut: p.chips,
      isBot: p.isBot,
    }));

    // Calculate zero-sum settlement (skips transactions if bots exist!)
    const settlement = calculateSettlements(playerInputs);

    // Broadcast close to WebSocket clients
    for (const conn of this.clients) {
      if (conn.channelId === channelId && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ type: 'table_closed', settlement }));
      }
    }

    // Post settlement summary and QR Code to Discord Text Channel
    if (this.discordClient) {
      try {
        const channel = (await this.discordClient.channels.fetch(channelId)) as TextChannel;
        if (channel && channel.isTextBased()) {
          const dbSession = await repo.getActiveSession(channelId);
          const dummySession: repo.SessionRow = dbSession || {
            id: table.handNumber,
            guild_id: channel.guildId || 'activity',
            channel_id: channelId,
            host_id: table.hostId,
            default_buyin: table.bigBlind * 10,
            status: 'completed',
            message_id: null,
            created_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
          };

          // Fetch user payment info
          const playersDb = await repo.getSessionPlayers(dummySession.id);
          const paymentMap: Record<string, { promptpay: string | null; qrImageUrl: string | null }> = {};
          for (const p of playersDb) {
            paymentMap[p.user_id] = { promptpay: p.promptpay, qrImageUrl: p.qr_image_url };
          }

          const embed = createSummaryEmbed(dummySession, settlement, paymentMap);
          const files: any[] = [];

          // Only attach QR code if NO bots played in the table!
          const topCreditor = !settlement.hasBots
            ? settlement.players.find(
                p =>
                  p.net > 0 &&
                  !p.isBot &&
                  !p.userId.startsWith('bot_') &&
                  (paymentMap[p.userId]?.qrImageUrl || paymentMap[p.userId]?.promptpay)
              )
            : undefined;

          if (topCreditor) {
            const pInfo = paymentMap[topCreditor.userId];
            const qrResult = await resolvePaymentAttachment(
              {
                userId: topCreditor.userId,
                name: topCreditor.name,
                promptpay: pInfo?.promptpay,
                qrImageUrl: pInfo?.qrImageUrl,
              },
              topCreditor.net
            );
            if (qrResult) {
              embed.setImage(`attachment://${qrResult.imageFileName}`);
              embed.addFields({
                name: qrResult.sourceType === 'custom_qr'
                  ? `📱 QR Code รับเงินของ ${topCreditor.name} (${topCreditor.net.toLocaleString()}฿)`
                  : `📱 QR Code พร้อมเพย์ของ ${topCreditor.name} (${topCreditor.net.toLocaleString()}฿)`,
                value: qrResult.sourceType === 'custom_qr'
                  ? `สแกน QR Code ด้านล่างเพื่อโอนเงินเข้าบัญชีได้ทันที (QR ที่ผู้เล่นอัปโหลดไว้)`
                  : `สามารถสแกน QR Code ด้านล่างเพื่อโอนเงินได้ทันที (สร้างยอดอัตโนมัติ ${topCreditor.net.toLocaleString()} บาท)`,
              });
              files.push(qrResult.attachment);
            }
          }

          const requesterTag = requestedByUserId ? `<@${requestedByUserId}>` : 'Host';
          await channel.send({
            content: `🏁 **${requesterTag} ได้ปิดโต๊ะ Poker Game และทำการคิดเงินเรียบร้อยแล้ว:**`,
            embeds: [embed],
            files,
          });
        }
      } catch (err) {
        console.error('Failed to post activity settlement to Discord:', err);
      }
    }

    // Remove table instance
    this.tables.delete(channelId);
  }
}
