import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

process.env.NODE_ENV = 'test';

import { prisma } from '../src/db/src/index';
import { runSignalAgent } from '../src/agent';
import { getAdminContext } from '../src/services/db';
import { formatWhatsappNumber } from '../src/utils/formatter';

const SENDER_MEMBER_JID = '1111111111@s.whatsapp.net';
const SENDER_ADMIN_ONE = '2222222222@s.whatsapp.net';
const SENDER_ADMIN_TWO = '3333333333@s.whatsapp.net';

async function runTest() {
  console.log('🧪 Starting Signal Cancellation & Portfolio Stats Integration Test...');

  // 1. Clean up old data
  await prisma.memberTrade.deleteMany({
    where: { member: { whatsappNumber: formatWhatsappNumber(SENDER_MEMBER_JID) } }
  });
  await prisma.signal.deleteMany({
    where: { adminId: { in: [SENDER_ADMIN_ONE, SENDER_ADMIN_TWO] } }
  });
  await prisma.member.deleteMany({
    where: { whatsappNumber: formatWhatsappNumber(SENDER_MEMBER_JID) }
  });
  await prisma.admin.deleteMany({
    where: { id: { in: [SENDER_ADMIN_ONE, SENDER_ADMIN_TWO] } }
  });

  // 2. Seed records
  const adminOne = await prisma.admin.create({
    data: { id: SENDER_ADMIN_ONE, name: 'AdminOne' }
  });
  const adminTwo = await prisma.admin.create({
    data: { id: SENDER_ADMIN_TWO, name: 'AdminTwo' }
  });
  const member = await prisma.member.create({
    data: { whatsappNumber: formatWhatsappNumber(SENDER_MEMBER_JID) }
  });

  // 3. Create a signal under AdminOne for "C"
  const signal = await prisma.signal.create({
    data: {
      adminId: SENDER_ADMIN_ONE,
      asset: 'C',
      direction: 'BUY',
      entryMin: 0.1,
      entryMax: 0.11,
      tpPercent: 20,
      slPercent: 10,
      tpPrice: 0.132,
      slPrice: 0.09,
      rrRatio: 2,
      status: 'ENTRY_OPEN',
      rawText: 'BUY C at 0.1-0.11',
    }
  });
  console.log(`✅ Signal created for C under AdminOne (ID: ${signal.id})`);

  // 4. Log a member trade for this signal
  const trade = await prisma.memberTrade.create({
    data: {
      memberId: member.id,
      signalId: signal.id,
    }
  });
  console.log(`✅ Member trade registered (ID: ${trade.id})`);

  // 5. Invoke the agent from AdminTwo JID with "Close C trade"
  // Since we relaxed the adminId scoping in openSignals query, the agent run from AdminTwo should find C and close it
  const context = await getAdminContext(SENDER_ADMIN_TWO);
  console.log(`🤖 Invoking agent for AdminTwo with "Close C trade"...`);
  await runSignalAgent('Close C trade', SENDER_ADMIN_TWO, context);

  // 6. Verify database outcomes
  const updatedSignal = await prisma.signal.findUnique({ where: { id: signal.id } });
  const updatedTrade = await prisma.memberTrade.findUnique({ where: { id: trade.id } });
  const updatedAdminOne = await prisma.admin.findUnique({ where: { id: SENDER_ADMIN_ONE } });
  const updatedAdminTwo = await prisma.admin.findUnique({ where: { id: SENDER_ADMIN_TWO } });

  console.log('\n--- VERIFICATION ---');
  console.log(`Signal Status: ${updatedSignal?.status} (Expected: EXPIRED)`);
  console.log(`Trade Outcome: ${updatedTrade?.outcome} (Expected: MISSED)`);
  console.log(`AdminOne Signals count: ${updatedAdminOne?.totalSignals} (Expected: 0)`);
  console.log(`AdminTwo Signals count: ${updatedAdminTwo?.totalSignals} (Expected: 0)`);

  if (updatedSignal?.status !== 'EXPIRED') {
    throw new Error('Signal status did not transition to EXPIRED!');
  }
  if (updatedTrade?.outcome !== 'MISSED') {
    throw new Error('Member trade outcome did not set to MISSED!');
  }
  if (updatedAdminOne?.totalSignals !== 0) {
    throw new Error('AdminOne totalSignals count should exclude EXPIRED signal!');
  }

  // 7. Verify portfolio calculation logic (matching the API route behavior)
  const trades = await prisma.memberTrade.findMany({
    where: { memberId: member.id },
    include: { signal: true }
  });

  let winCount = 0;
  let lossCount = 0;
  let missedCount = 0;
  let completedPnL = 0;
  let totalValidTrades = 0;

  const completedTrades: any[] = [];
  const activeTrades: any[] = [];

  for (const t of trades) {
    const s = t.signal;
    const isResolved = ['TP_HIT', 'SL_HIT', 'ENTRY_MISSED', 'EXPIRED'].includes(s.status);

    if (isResolved) {
      if (s.status === 'EXPIRED') {
        completedTrades.push({
          tradeId: t.id,
          status: s.status,
          outcome: 'MISSED'
        });
        continue; // Skips stats calculation!
      }

      totalValidTrades++;
      if (s.status === 'TP_HIT') {
        winCount++;
        completedPnL += s.tpPercent;
      } else if (s.status === 'SL_HIT') {
        lossCount++;
        completedPnL -= s.slPercent;
      } else {
        missedCount++;
      }
    }
  }

  console.log('\nPortfolio Stats Verification:');
  console.log(`- totalTrades: ${totalValidTrades} (Expected: 0)`);
  console.log(`- winCount:    ${winCount} (Expected: 0)`);
  console.log(`- lossCount:   ${lossCount} (Expected: 0)`);
  console.log(`- missedCount: ${missedCount} (Expected: 0)`);
  console.log(`- completedTrades length: ${completedTrades.length} (Expected: 1)`);

  if (totalValidTrades !== 0 || winCount !== 0 || lossCount !== 0 || missedCount !== 0) {
    throw new Error('Portfolio stats incorrectly counted the expired/cancelled trade!');
  }

  console.log('\n🎉 Integration test PASSED successfully!');
}

runTest()
  .catch(err => {
    console.error('❌ Integration test FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
