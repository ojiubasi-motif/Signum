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
import { formatWhatsappNumber, formatPrice } from '../utils/formatter';
import { setWhatsappSocket } from '../services/whatsapp';
import { sendPushNotification } from '../services/fcm';
import { processReviewDecision } from '../services/db';
import pino from 'pino';

// Helper to resolve an incoming JID to its canonical admin JID if it matches
function getCanonicalAdminJid(jid: string): string {
  if (!jid) return jid;
  const formattedJid = formatWhatsappNumber(jid);
  const matchedAdmin = ADMIN_NUMBERS.find(
    adminJid => formatWhatsappNumber(adminJid) === formattedJid
  );
  return matchedAdmin || jid;
}

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

  setWhatsappSocket(sock);

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

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      // Ignore WhatsApp status updates and general broadcasts
      if (
        remoteJid === 'status@broadcast' ||
        remoteJid.endsWith('@broadcast') ||
        msg.broadcast === true
      ) {
        continue;
      }

      // Check for message deletion (revoke)
      const protocolMsg = msg.message?.protocolMessage;
      if (protocolMsg && ((protocolMsg.type as any) === 3 || (protocolMsg.type as any) === 'REVOKE')) {
        const deletedMsgId = protocolMsg.key?.id;
        const sender = msg.key.participant || msg.participant || '';
        const canonicalSender = getCanonicalAdminJid(sender);
        
        if (remoteJid === TARGET_GROUP_ID && ADMIN_NUMBERS.includes(canonicalSender) && deletedMsgId) {
          console.log(`🗑️ Signal Author deleted message. ID: ${deletedMsgId}. Deleting signal from DB...`);
          try {
            const signalToDel = await prisma.signal.findFirst({
              where: { messageId: deletedMsgId }
            });
            if (signalToDel) {
              await prisma.$transaction([
                prisma.memberTrade.deleteMany({
                  where: { signalId: signalToDel.id }
                }),
                prisma.signal.delete({
                  where: { id: signalToDel.id }
                })
              ]);
              console.log(`✅ Successfully deleted signal ${signalToDel.id} and its associated member trades.`);
            }
          } catch (err: any) {
            console.error(`❌ Failed to delete signal for messageId ${deletedMsgId}:`, err.message);
          }
        }
        continue;
      }

      const text = extractText(msg);
      const sender = msg.key.participant || remoteJid;

      // Temporary log to help locate TARGET_GROUP_ID and admin numbers
      console.log(`📩 Message Event: "${text ?? '[No Text]'}"`);
      console.log(`   └─ From (Group/Chat JID): ${formatWhatsappNumber(remoteJid)}`);
      console.log(`   └─ Sender (User JID):      ${formatWhatsappNumber(sender)}`);

      // Handle member DMs
      if (remoteJid !== TARGET_GROUP_ID) {
        if (!text) continue;

        const canonicalRemoteJid = getCanonicalAdminJid(remoteJid);
        const isAdmin = ADMIN_NUMBERS.includes(canonicalRemoteJid);
        let processedChoice = false;

        if (isAdmin) {
          const pendingSignal = await prisma.signal.findFirst({
            where: {
              adminId: canonicalRemoteJid,
              status: 'PENDING',
              coingeckoId: null
            },
            orderBy: {
              createdAt: 'desc'
            }
          });

          if (pendingSignal && pendingSignal.enrichment) {
            const enrichment = pendingSignal.enrichment as any;
            if (enrichment.pendingReview === true) {
              const cleanText = text.trim().toLowerCase();
              if (cleanText === 'approve' || cleanText === 'reject' || cleanText === 'yes' || cleanText === 'no') {
                const decision = (cleanText === 'approve' || cleanText === 'yes') ? 'approve' : 'reject';
                const { processed } = await processReviewDecision(canonicalRemoteJid, decision);
                if (processed) {
                  processedChoice = true;
                }
              }
            } else {
              const candidates = enrichment.coingeckoCandidates;
              if (Array.isArray(candidates) && candidates.length > 0) {
                const choiceIndex = parseInt(text.trim(), 10) - 1;
                if (!isNaN(choiceIndex) && choiceIndex >= 0 && choiceIndex < candidates.length) {
                  const selectedCoin = candidates[choiceIndex];

                  // Update signal
                  await prisma.signal.update({
                    where: { id: pendingSignal.id },
                    data: {
                      coingeckoId: selectedCoin.id,
                      status: 'ENTRY_OPEN'
                    }
                  });

                  // Send member notification alert
                  const alertMsg = `🚀 *NEW SIGNAL*: ${pendingSignal.direction} ${pendingSignal.asset} at ${formatPrice(pendingSignal.entryMin)}-${formatPrice(pendingSignal.entryMax)}`;
                  await sendPushNotification({
                    signalId: pendingSignal.id,
                    urgencyScore: pendingSignal.urgencyScore,
                    message: alertMsg
                  });

                  await sock.sendMessage(remoteJid, {
                    text: `✅ CoinGecko ID resolved to *${selectedCoin.name}* (${selectedCoin.id}). Signal is now active and members have been notified!`
                  });

                  await sock.sendMessage(TARGET_GROUP_ID, {
                    text: `📈 *Signal Activated*: ${pendingSignal.direction} ${pendingSignal.asset} (CoinGecko: ${selectedCoin.name})`
                  });

                  processedChoice = true;
                } else {
                  await sock.sendMessage(remoteJid, {
                    text: `⚠️ Invalid selection. Please reply with a number between 1 and ${candidates.length} corresponding to the options above.`
                  });
                  processedChoice = true;
                }
              }
            }
          }
        }

        if (processedChoice) {
          continue;
        }

        const readableNumber = formatWhatsappNumber(remoteJid);

        // Authorize DM check: check if the member exists in the database or is an admin
        const isAuthorized = isAdmin || (await prisma.member.findUnique({
          where: { whatsappNumber: readableNumber }
        }));

        if (!isAuthorized) {
          console.warn(`🔒 Unauthorized DM from ${readableNumber} blocked.`);
          try {
            await sock.sendMessage(remoteJid, {
              text: '🔒 *Access Denied*: You must be a member of the official Signum WhatsApp group to access this bot.'
            });
          } catch (err: any) {
            console.error(`❌ Failed to send access denied warning to ${readableNumber}:`, err.message);
          }
          continue;
        }

        console.log(`💬 Member DM from ${readableNumber}: "${text}"`);
        try {
          const reply = await processMemberMessage(readableNumber, text);
          await sock.sendMessage(remoteJid, { text: reply });
        } catch (err: any) {
          console.error(`❌ Failed to process member DM from ${readableNumber}:`, err.message);
        }
        continue;
      }

      // Only process messages from the 2 admins in group
      const senderId = msg.key.participant ?? '';
      const canonicalSenderId = getCanonicalAdminJid(senderId);
      if (!ADMIN_NUMBERS.includes(canonicalSenderId)) continue;

      if (!text) continue;

      // Drop into queue — bot's job ends here
      await signalQueue.add('signal', {
        type: 'PROCESS_NEW_MESSAGE',
        text,
        adminId: canonicalSenderId,
        messageId: msg.key.id ?? '',
        timestamp: Number(msg.messageTimestamp)
      });

      console.log(`📡 Sniped from ${canonicalSenderId}: ${text.slice(0, 60)}...`);
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
