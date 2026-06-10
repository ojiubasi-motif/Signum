import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { TARGET_GROUP_ID } from '../src/config/constants';
import { formatWhatsappNumber, LID_TO_PHONE_CACHE } from '../src/utils/formatter';

async function run() {
  console.log('🔄 Connecting to WhatsApp to fetch live group participants metadata...');
  
  const { state } = await useMultiFileAuthState('./auth-session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', async ({ connection }) => {
    if (connection === 'open') {
      console.log('✅ WhatsApp connection opened successfully!');
      try {
        console.log(`👥 Fetching metadata for group: ${TARGET_GROUP_ID}...`);
        const metadata = await sock.groupMetadata(TARGET_GROUP_ID);
        if (!metadata || !metadata.participants) {
          throw new Error('No participants found in metadata.');
        }

        console.log(`\n📋 Live Group Participants (${metadata.participants.length} found):`);
        console.log('----------------------------------------------------------------------');
        
        // Populate dynamic LID-to-Phone cache
        for (const p of metadata.participants) {
          if (p.id && p.jid) {
            const rawLid = p.id.split('@')[0];
            const rawPhone = p.jid.split('@')[0];
            LID_TO_PHONE_CACHE.set(rawLid, rawPhone);
          }
        }

        for (const p of metadata.participants) {
          const rawId = p.id;
          const phoneJid = p.jid || 'N/A';
          const formatted = formatWhatsappNumber(rawId);
          console.log(`JID: ${rawId.padEnd(25)} | Real JID: ${phoneJid.padEnd(30)} => Display: ${formatted}`);
        }
        
        console.log('----------------------------------------------------------------------\n');
      } catch (err: any) {
        console.error('❌ Failed to fetch group metadata:', err.message);
      } finally {
        sock.end(undefined);
        process.exit(0);
      }
    }
  });
}

run().catch(err => {
  console.error('❌ Run error:', err);
  process.exit(1);
});
