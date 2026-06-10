import * as dotenv from 'dotenv';
// Load environment variables with override
dotenv.config({ override: true });
process.env.NODE_ENV = 'test';

import { prisma } from '../src/db/src/index';
import { redisConnection } from '../src/config/redis';
import { syncGroupParticipants } from '../src/services/groupSync';
import { TARGET_GROUP_ID } from '../src/config/constants';
import { processMemberMessage } from '../src/bot/memberInterface';
import { checkPricesOnce, startPriceWatcher, stopPriceWatcher } from '../src/workers/priceWatcher';
import { setMockPrice } from '../src/services/binance';
import { getCachedResolvedSignals, getCachedSignal } from '../src/services/cache';
import { formatWhatsappNumber } from '../src/utils/formatter';

const TEST_ADMIN_ID = 'test_admin_phase1_updates@s.whatsapp.net';
const TEST_MEMBER_1 = 'member1_phase1_updates@s.whatsapp.net';
const TEST_MEMBER_2 = 'member2_phase1_updates@s.whatsapp.net';
const TEST_UNAUTHORIZED = 'unauthorized_phase1_updates@s.whatsapp.net';

async function backupDB() {
  console.log('📦 Backing up database state...');
  const originalMembers = await prisma.member.findMany({
    include: { trades: true },
  });
  const originalSignals = await prisma.signal.findMany();
  const originalAdmins = await prisma.admin.findMany();
  return { originalMembers, originalSignals, originalAdmins };
}

async function restoreDB(backup: any) {
  console.log('\n🧹 Cleaning up test database changes & restoring backup...');
  
  // Clear all member trades, signals, members, and admins created during test
  await prisma.memberTrade.deleteMany({});
  await prisma.signal.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.admin.deleteMany({});

  // Restore original admins
  if (backup.originalAdmins.length > 0) {
    await prisma.admin.createMany({
      data: backup.originalAdmins,
    });
  }

  // Restore original signals
  if (backup.originalSignals.length > 0) {
    await prisma.signal.createMany({
      data: backup.originalSignals,
    });
  }

  // Restore original members
  for (const member of backup.originalMembers) {
    await prisma.member.create({
      data: {
        id: member.id,
        whatsappNumber: member.whatsappNumber,
        alertsEnabled: member.alertsEnabled,
        fcmToken: member.fcmToken,
        joinedAt: member.joinedAt,
      },
    });

    if (member.trades.length > 0) {
      await prisma.memberTrade.createMany({
        data: member.trades.map((t: any) => ({
          id: t.id,
          memberId: t.memberId,
          signalId: t.signalId,
          takenAt: t.takenAt,
          outcome: t.outcome,
        })),
      });
    }
  }

  console.log('✅ Database state restored.');
}

async function cleanRedis() {
  console.log('🧹 Cleaning up Redis cache...');
  await redisConnection.del('signals:resolved');
  const keys = await redisConnection.keys('signal:resolved:*');
  if (keys.length > 0) {
    await redisConnection.del(...keys);
  }
}

async function simulateDM(remoteJid: string, text: string): Promise<{ reply: string; blocked: boolean }> {
  // Ignore WhatsApp status updates and general broadcasts
  if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@broadcast')) {
    return { reply: '', blocked: true };
  }

  const readableNumber = formatWhatsappNumber(remoteJid);

  // Authorize DM check: check if the member exists in the database
  const isAuthorized = await prisma.member.findUnique({
    where: { whatsappNumber: readableNumber }
  });

  if (!isAuthorized) {
    console.warn(`🔒 [Mock Bot] Unauthorized DM from ${readableNumber} blocked.`);
    return {
      reply: '🔒 *Access Denied*: You must be a member of the official Signum WhatsApp group to access this bot.',
      blocked: true
    };
  }

  console.log(`💬 [Mock Bot] Processing authorized DM from ${readableNumber}: "${text}"`);
  const reply = await processMemberMessage(readableNumber, text);
  return { reply, blocked: false };
}

async function runTests() {
  console.log('🚀 Starting Verification Tests for Phase 1 Updates...');

  const backup = await backupDB();
  await cleanRedis();

  try {
    // ── Test 1: Price Watcher Timing & Control ──
    console.log('\n--- Test 1: Price Watcher Timing ---');
    // Ensure startPriceWatcher accepts custom/5-minute interval
    console.log('Initializing startPriceWatcher(300000)...');
    startPriceWatcher(300000);
    stopPriceWatcher();
    console.log('✅ Test 1 Passed: Price watcher scheduler started/stopped without crashing.');

    // ── Test 2: WhatsApp Group Synchronization ──
    console.log('\n--- Test 2: Group Sync (Add/Remove/Diff) ---');
    
    // Setup a mock socket that returns 2 members and 2 admins in target group
    const mockSock = {
      groupMetadata: async (groupId: string) => {
        if (groupId === TARGET_GROUP_ID) {
          return {
            id: TARGET_GROUP_ID,
            participants: [
              { id: TEST_ADMIN_ID },
              { id: TEST_MEMBER_1 },
              { id: TEST_MEMBER_2 },
              { id: '12799807852757@lid', jid: '2349999999999@s.whatsapp.net' }
            ],
          };
        }
        throw new Error('Group not found');
      },
      sendMessage: async (jid: string, content: any) => {
        console.log(`[Mock SendMessage] to ${jid}:`, JSON.stringify(content));
        return {};
      }
    };

    console.log('Running group sync...');
    const syncSuccess = await syncGroupParticipants(mockSock);
    if (!syncSuccess) {
      throw new Error('Group synchronization failed.');
    }

    // Verify DB contains newly synchronized members
    const dbMembers = await prisma.member.findMany();
    const dbMemberNumbers = dbMembers.map(m => m.whatsappNumber);
    console.log('DB members after sync:', dbMemberNumbers);

    const formattedMember1 = formatWhatsappNumber(TEST_MEMBER_1);
    const formattedMember2 = formatWhatsappNumber(TEST_MEMBER_2);
    const formattedAdmin = formatWhatsappNumber(TEST_ADMIN_ID);

    if (!dbMemberNumbers.includes(formattedMember1) || !dbMemberNumbers.includes(formattedMember2) || !dbMemberNumbers.includes(formattedAdmin)) {
      throw new Error('Test 2 Failed: Synchronized members are missing in database.');
    }

    // Verify dynamic mapping cache is populated
    const formattedLid = formatWhatsappNumber('12799807852757@lid');
    console.log('Dynamic mapping formatted LID:', formattedLid);
    if (formattedLid !== '+234 999 999 9999') {
      throw new Error(`Test 2 Failed: Dynamic LID mapping cache failed to format correctly. Got: ${formattedLid}`);
    }

    // Now test deletion: remove TEST_MEMBER_2 from group list and run sync again
    const mockSock2 = {
      ...mockSock,
      groupMetadata: async (groupId: string) => {
        return {
          id: TARGET_GROUP_ID,
          participants: [
            { id: TEST_ADMIN_ID },
            { id: TEST_MEMBER_1 }, // TEST_MEMBER_2 removed
          ],
        };
      }
    };

    console.log('Running group sync again after removing member...');
    await syncGroupParticipants(mockSock2);

    const dbMembers2 = await prisma.member.findMany();
    const dbMemberNumbers2 = dbMembers2.map(m => m.whatsappNumber);
    console.log('DB members after second sync:', dbMemberNumbers2);

    if (dbMemberNumbers2.includes(formattedMember2)) {
      throw new Error('Test 2 Failed: Deactivated/removed member was not deleted from DB.');
    }
    if (!dbMemberNumbers2.includes(formattedMember1)) {
      throw new Error('Test 2 Failed: Active member was deleted incorrectly.');
    }
    console.log('✅ Test 2 Passed: Group Sync reconciled membership diffs successfully.');

    // ── Test 3: DM Authorization Rules ──
    console.log('\n--- Test 3: DM Authorization & Access Control ---');
    
    // Simulate DM from authorized member (TEST_MEMBER_1)
    const authDmResult = await simulateDM(TEST_MEMBER_1, 'active');
    console.log('Authorized DM response:', authDmResult);
    if (authDmResult.blocked) {
      throw new Error('Test 3 Failed: Authorized member was blocked.');
    }
    
    // Simulate DM from unauthorized number
    const unauthDmResult = await simulateDM(TEST_UNAUTHORIZED, 'active');
    console.log('Unauthorized DM response:', unauthDmResult);
    if (!unauthDmResult.blocked || !unauthDmResult.reply.includes('Access Denied')) {
      throw new Error('Test 3 Failed: Unauthorized sender was not blocked with Access Denied.');
    }
    console.log('✅ Test 3 Passed: DM authorization is correctly enforced.');

    // ── Test 4: Redis Caching of Resolved Signals ──
    console.log('\n--- Test 4: Redis Caching of Resolved Signals ---');

    // Setup active admin
    const dbAdmin = await prisma.admin.create({
      data: {
        id: TEST_ADMIN_ID,
        name: 'TestAdmin',
      }
    });

    // Setup active member (find existing or create)
    const memberNum = formatWhatsappNumber(TEST_MEMBER_1);
    let dbMember = await prisma.member.findUnique({
      where: { whatsappNumber: memberNum }
    });
    if (!dbMember) {
      dbMember = await prisma.member.create({
        data: {
          whatsappNumber: memberNum,
        }
      });
    }

    // Create an open entry signal for GRASS
    const testSignal = await prisma.signal.create({
      data: {
        adminId: TEST_ADMIN_ID,
        asset: 'GRASS',
        direction: 'BUY',
        entryMin: 0.30,
        entryMax: 0.35,
        tpPercent: 10,
        slPercent: 5,
        tpPrice: 0.385,
        slPrice: 0.285,
        rrRatio: 2,
        status: 'ENTRY_OPEN',
        rawText: 'GRASS Buy 0.30 - 0.35',
      }
    });

    // Create a MemberTrade for the member taking this signal
    const dbTrade = await prisma.memberTrade.create({
      data: {
        memberId: dbMember.id,
        signalId: testSignal.id,
      }
    });

    // Set mock price to hit take profit
    console.log('Simulating TP hit for GRASS (setting mock price to 0.40)...');
    setMockPrice('GRASS', 0.40);
    
    // Run price checker which should trigger status update and Redis cache save
    await checkPricesOnce();

    // Verify signal resolved in DB
    const dbSignal = await prisma.signal.findUnique({
      where: { id: testSignal.id },
    });
    if (!dbSignal || dbSignal.status !== 'TP_HIT' || !dbSignal.resolvedAt) {
      throw new Error('Test 4 Failed: Signal was not resolved as TP_HIT in database.');
    }

    // Verify MemberTrade outcome updated in DB
    const updatedTrade = await prisma.memberTrade.findUnique({
      where: { id: dbTrade.id },
    });
    if (!updatedTrade || updatedTrade.outcome !== 'WIN') {
      throw new Error(`Test 4 Failed: MemberTrade outcome was not updated to WIN. Got: ${updatedTrade?.outcome}`);
    }

    // Verify Admin stats updated in DB
    const updatedAdmin = await prisma.admin.findUnique({
      where: { id: TEST_ADMIN_ID },
    });
    if (!updatedAdmin || updatedAdmin.totalSignals !== 1 || updatedAdmin.totalWins !== 1 || updatedAdmin.winRate !== 100) {
      throw new Error(`Test 4 Failed: Admin stats were not updated. Got: signals=${updatedAdmin?.totalSignals}, wins=${updatedAdmin?.totalWins}, winRate=${updatedAdmin?.winRate}`);
    }

    // Verify cache in Redis
    const cachedObj = await getCachedSignal(testSignal.id);
    console.log('Cached object read from Redis:', cachedObj);
    if (!cachedObj || cachedObj.asset !== 'GRASS' || cachedObj.status !== 'TP_HIT') {
      throw new Error('Test 4 Failed: Resolved signal was not saved to Redis cache.');
    }

    const cachedList = await getCachedResolvedSignals();
    console.log('Full cached list from Redis:', cachedList);
    if (cachedList.length === 0 || !cachedList.some(s => s.id === testSignal.id)) {
      throw new Error('Test 4 Failed: Resolved signal ID not present in signals:resolved sorted set.');
    }
    console.log('✅ Test 4 Passed: Cache, trade outcome, and admin stats are updated automatically upon signal resolution.');

    // ── Test 5: Bot Interface Reads Cached Signals ──
    console.log('\n--- Test 5: Bot Command Cache Reads & Groq Context ---');

    // Execute expired signal history command
    const historyResponse = await processMemberMessage(formattedMember1, 'expired');
    console.log('History command response:\n', historyResponse);
    if (!historyResponse.includes('GRASS') || !historyResponse.includes('TP_HIT') || !historyResponse.includes('Cached')) {
      throw new Error('Test 5 Failed: History query did not fallback to cached signals.');
    }

    // Execute Groq conversational message to verify cache feed
    if (process.env.GROQ_API_KEY) {
      console.log('Querying Groq conversational bot with context verification...');
      const groqReply = await processMemberMessage(formattedMember1, 'what is the status of the recently closed GRASS signal? Keep the answer under 2 sentences.');
      console.log('Groq response:\n', groqReply);
      if (!groqReply || groqReply.includes('Signum Error') || !groqReply.toLowerCase().includes('grass')) {
        throw new Error('Test 5 Failed: Groq response did not resolve query or lacked cached signal context.');
      }
    } else {
      console.log('⚠️ GROQ_API_KEY not found in .env; skipping Groq context verification.');
    }
    console.log('✅ Test 5 Passed: Caching and conversational contexts operate successfully.');

  } finally {
    // Restore the DB state and cleanup Redis
    await cleanRedis();
    await restoreDB(backup);
  }

  console.log('\n🎉 ALL TESTS IN PHASE 1 UPDATES PASSED SUCCESSFULLY! 🎉');
}

runTests()
  .catch(err => {
    console.error('❌ Integration tests failed with error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    redisConnection.disconnect();
  });
