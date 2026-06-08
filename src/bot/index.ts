import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WAMessage
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { signalQueue } from '../queue';
import { prisma } from '../db/src/index';
import { ADMIN_NUMBERS, TARGET_GROUP_ID } from '../config/constants';
import { processMemberMessage } from './memberInterface';
import { syncGroupParticipants } from '../services/groupSync';
import pino from 'pino';

export async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth-session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,   // stay invisible
    printQRInTerminal: false      // custom QR printing below
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('📌 Scan the QR code below to authenticate with WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('📌 WhatsApp connection opened successfully!');
      syncGroupParticipants(sock).catch(err => {
        console.error('❌ Failed to run initial group sync on boot:', err);
      });
    }

    if (connection === 'close') {
      const error = lastDisconnect?.error as any;
      const code = error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('Reconnecting...');
        startBot();
      }
    }
  });

  // ── GROUP UPDATES LISTENERS ──
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (id !== TARGET_GROUP_ID) return;
    console.log(`👥 Group participants update event received: ${action} | Syncing database...`);
    await syncGroupParticipants(sock);
  });

  // ── SNIPING & DM LOGIC ──
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const text = extractText(msg);
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;
      const sender = msg.key.participant || remoteJid;

      // Temporary log to help locate TARGET_GROUP_ID and admin numbers
      console.log(`📩 Message Event: "${text ?? '[No Text]'}"`);
      console.log(`   └─ From (Group/Chat JID): ${remoteJid}`);
      console.log(`   └─ Sender (User JID):      ${sender}`);

      // Ignore WhatsApp status updates and general broadcasts
      if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@broadcast')) {
        continue;
      }

      // Handle member DMs
      if (remoteJid !== TARGET_GROUP_ID) {
        if (!text) continue;

        // Authorize DM check: check if the member exists in the database
        const isAuthorized = await prisma.member.findUnique({
          where: { whatsappNumber: remoteJid }
        });

        if (!isAuthorized) {
          console.warn(`🔒 Unauthorized DM from ${remoteJid} blocked.`);
          try {
            await sock.sendMessage(remoteJid, {
              text: '🔒 *Access Denied*: You must be a member of the official Signum WhatsApp group to access this bot.'
            });
          } catch (err: any) {
            console.error(`❌ Failed to send access denied warning to ${remoteJid}:`, err.message);
          }
          continue;
        }

        console.log(`💬 Member DM from ${remoteJid}: "${text}"`);
        try {
          const reply = await processMemberMessage(remoteJid, text);
          await sock.sendMessage(remoteJid, { text: reply });
        } catch (err: any) {
          console.error(`❌ Failed to process member DM from ${remoteJid}:`, err.message);
        }
        continue;
      }

      // Only process messages from the 2 admins in group
      const senderId = msg.key.participant ?? '';
      if (!ADMIN_NUMBERS.includes(senderId)) continue;

      if (!text) continue;

      // Drop into queue — bot's job ends here
      await signalQueue.add('signal', {
        type: 'PROCESS_NEW_MESSAGE',
        text,
        adminId: senderId,
        messageId: msg.key.id ?? '',
        timestamp: Number(msg.messageTimestamp)
      });

      console.log(`📡 Sniped from ${senderId}: ${text.slice(0, 60)}...`);
    }
  });
}

function extractText(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    null
  );
}
