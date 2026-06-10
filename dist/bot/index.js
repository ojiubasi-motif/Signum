"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBot = startBot;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const queue_1 = require("../queue");
const index_1 = require("../db/src/index");
const constants_1 = require("../config/constants");
const memberInterface_1 = require("./memberInterface");
const groupSync_1 = require("../services/groupSync");
const formatter_1 = require("../utils/formatter");
const whatsapp_1 = require("../services/whatsapp");
const fcm_1 = require("../services/fcm");
const pino_1 = __importDefault(require("pino"));
// Helper to resolve an incoming JID to its canonical admin JID if it matches
function getCanonicalAdminJid(jid) {
    if (!jid)
        return jid;
    const formattedJid = (0, formatter_1.formatWhatsappNumber)(jid);
    const matchedAdmin = constants_1.ADMIN_NUMBERS.find(adminJid => (0, formatter_1.formatWhatsappNumber)(adminJid) === formattedJid);
    return matchedAdmin || jid;
}
async function startBot() {
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)('./auth-session');
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    const sock = (0, baileys_1.default)({
        version,
        auth: state,
        logger: (0, pino_1.default)({ level: 'silent' }),
        markOnlineOnConnect: false, // stay invisible
        printQRInTerminal: false // custom QR printing below
    });
    (0, whatsapp_1.setWhatsappSocket)(sock);
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('📌 Scan the QR code below to authenticate with WhatsApp:');
            qrcode_terminal_1.default.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('📌 WhatsApp connection opened successfully!');
            (0, groupSync_1.syncGroupParticipants)(sock).catch(err => {
                console.error('❌ Failed to run initial group sync on boot:', err);
            });
        }
        if (connection === 'close') {
            const error = lastDisconnect?.error;
            const code = error?.output?.statusCode;
            if (code !== baileys_1.DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                startBot();
            }
        }
    });
    // ── GROUP UPDATES LISTENERS ──
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (id !== constants_1.TARGET_GROUP_ID)
            return;
        console.log(`👥 Group participants update event received: ${action} | Syncing database...`);
        await (0, groupSync_1.syncGroupParticipants)(sock);
    });
    // ── SNIPING & DM LOGIC ──
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify')
            return;
        for (const msg of messages) {
            if (msg.key.fromMe)
                continue;
            const remoteJid = msg.key.remoteJid;
            if (!remoteJid)
                continue;
            // Ignore WhatsApp status updates and general broadcasts
            if (remoteJid === 'status@broadcast' ||
                remoteJid.endsWith('@broadcast') ||
                msg.broadcast === true) {
                continue;
            }
            // Check for message deletion (revoke)
            const protocolMsg = msg.message?.protocolMessage;
            if (protocolMsg && (protocolMsg.type === 3 || protocolMsg.type === 'REVOKE')) {
                const deletedMsgId = protocolMsg.key?.id;
                const sender = msg.key.participant || msg.participant || '';
                const canonicalSender = getCanonicalAdminJid(sender);
                if (remoteJid === constants_1.TARGET_GROUP_ID && constants_1.ADMIN_NUMBERS.includes(canonicalSender) && deletedMsgId) {
                    console.log(`🗑️ Signal Author deleted message. ID: ${deletedMsgId}. Deleting signal from DB...`);
                    try {
                        const signalToDel = await index_1.prisma.signal.findFirst({
                            where: { messageId: deletedMsgId }
                        });
                        if (signalToDel) {
                            await index_1.prisma.$transaction([
                                index_1.prisma.memberTrade.deleteMany({
                                    where: { signalId: signalToDel.id }
                                }),
                                index_1.prisma.signal.delete({
                                    where: { id: signalToDel.id }
                                })
                            ]);
                            console.log(`✅ Successfully deleted signal ${signalToDel.id} and its associated member trades.`);
                        }
                    }
                    catch (err) {
                        console.error(`❌ Failed to delete signal for messageId ${deletedMsgId}:`, err.message);
                    }
                }
                continue;
            }
            const text = extractText(msg);
            const sender = msg.key.participant || remoteJid;
            // Temporary log to help locate TARGET_GROUP_ID and admin numbers
            console.log(`📩 Message Event: "${text ?? '[No Text]'}"`);
            console.log(`   └─ From (Group/Chat JID): ${(0, formatter_1.formatWhatsappNumber)(remoteJid)}`);
            console.log(`   └─ Sender (User JID):      ${(0, formatter_1.formatWhatsappNumber)(sender)}`);
            // Handle member DMs
            if (remoteJid !== constants_1.TARGET_GROUP_ID) {
                if (!text)
                    continue;
                const canonicalRemoteJid = getCanonicalAdminJid(remoteJid);
                const isAdmin = constants_1.ADMIN_NUMBERS.includes(canonicalRemoteJid);
                let processedChoice = false;
                if (isAdmin) {
                    const pendingSignal = await index_1.prisma.signal.findFirst({
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
                        const enrichment = pendingSignal.enrichment;
                        const candidates = enrichment.coingeckoCandidates;
                        if (Array.isArray(candidates) && candidates.length > 0) {
                            const choiceIndex = parseInt(text.trim(), 10) - 1;
                            if (!isNaN(choiceIndex) && choiceIndex >= 0 && choiceIndex < candidates.length) {
                                const selectedCoin = candidates[choiceIndex];
                                // Update signal
                                await index_1.prisma.signal.update({
                                    where: { id: pendingSignal.id },
                                    data: {
                                        coingeckoId: selectedCoin.id,
                                        status: 'ENTRY_OPEN'
                                    }
                                });
                                // Send member notification alert
                                const alertMsg = `🚀 *NEW SIGNAL*: ${pendingSignal.direction} ${pendingSignal.asset} at ${pendingSignal.entryMin}-${pendingSignal.entryMax}`;
                                await (0, fcm_1.sendPushNotification)({
                                    signalId: pendingSignal.id,
                                    urgencyScore: pendingSignal.urgencyScore,
                                    message: alertMsg
                                });
                                await sock.sendMessage(remoteJid, {
                                    text: `✅ CoinGecko ID resolved to *${selectedCoin.name}* (${selectedCoin.id}). Signal is now active and members have been notified!`
                                });
                                await sock.sendMessage(constants_1.TARGET_GROUP_ID, {
                                    text: `📈 *Signal Activated*: ${pendingSignal.direction} ${pendingSignal.asset} (CoinGecko: ${selectedCoin.name})`
                                });
                                processedChoice = true;
                            }
                            else {
                                await sock.sendMessage(remoteJid, {
                                    text: `⚠️ Invalid selection. Please reply with a number between 1 and ${candidates.length} corresponding to the options above.`
                                });
                                processedChoice = true;
                            }
                        }
                    }
                }
                if (processedChoice) {
                    continue;
                }
                const readableNumber = (0, formatter_1.formatWhatsappNumber)(remoteJid);
                // Authorize DM check: check if the member exists in the database or is an admin
                const isAuthorized = isAdmin || (await index_1.prisma.member.findUnique({
                    where: { whatsappNumber: readableNumber }
                }));
                if (!isAuthorized) {
                    console.warn(`🔒 Unauthorized DM from ${readableNumber} blocked.`);
                    try {
                        await sock.sendMessage(remoteJid, {
                            text: '🔒 *Access Denied*: You must be a member of the official Signum WhatsApp group to access this bot.'
                        });
                    }
                    catch (err) {
                        console.error(`❌ Failed to send access denied warning to ${readableNumber}:`, err.message);
                    }
                    continue;
                }
                console.log(`💬 Member DM from ${readableNumber}: "${text}"`);
                try {
                    const reply = await (0, memberInterface_1.processMemberMessage)(readableNumber, text);
                    await sock.sendMessage(remoteJid, { text: reply });
                }
                catch (err) {
                    console.error(`❌ Failed to process member DM from ${readableNumber}:`, err.message);
                }
                continue;
            }
            // Only process messages from the 2 admins in group
            const senderId = msg.key.participant ?? '';
            const canonicalSenderId = getCanonicalAdminJid(senderId);
            if (!constants_1.ADMIN_NUMBERS.includes(canonicalSenderId))
                continue;
            if (!text)
                continue;
            // Drop into queue — bot's job ends here
            await queue_1.signalQueue.add('signal', {
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
function extractText(msg) {
    const m = msg.message;
    if (!m)
        return null;
    return (m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        null);
}
