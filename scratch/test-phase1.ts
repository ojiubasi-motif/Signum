import * as dotenv from 'dotenv';
// Load environment variables with override
dotenv.config({ override: true });
process.env.NODE_ENV = 'test';

import { prisma } from '../src/db/src/index';
import { processMemberMessage } from '../src/bot/memberInterface';
import { checkPricesOnce } from '../src/workers/priceWatcher';
import { setMockPrice } from '../src/services/binance';

const TEST_ADMIN_ID = '999999999@lid';
const TEST_MEMBER_ID = '888888888@lid';

async function setupTestData() {
  console.log('\n🧹 Cleaning old test data...');
  // Clean up any old test trades/signals/members/admins to avoid duplicates
  await prisma.memberTrade.deleteMany({
    where: {
      member: { whatsappNumber: TEST_MEMBER_ID },
    },
  });
  await prisma.signal.deleteMany({
    where: { adminId: TEST_ADMIN_ID },
  });
  await prisma.member.deleteMany({
    where: { whatsappNumber: TEST_MEMBER_ID },
  });
  await prisma.admin.deleteMany({
    where: { id: TEST_ADMIN_ID },
  });

  console.log('🌱 Seeding mock admin & signal...');
  // Seed admin
  await prisma.admin.create({
    data: {
      id: TEST_ADMIN_ID,
      name: 'TestMaster',
      winRate: 85.5,
      totalSignals: 20,
      totalWins: 17,
    },
  });

  // Seed open BUY signal for SOL
  const openSignal = await prisma.signal.create({
    data: {
      adminId: TEST_ADMIN_ID,
      asset: 'SOL',
      direction: 'BUY',
      entryMin: 140,
      entryMax: 150,
      tpPercent: 10,
      slPercent: 5,
      tpPrice: 165, // 150 * 1.10
      slPrice: 133, // 140 * 0.95
      rrRatio: 2,
      urgencyScore: 8,
      status: 'ENTRY_OPEN',
      rawText: 'SOL Buy: 140 - 150 Target: 10% Stop: 5%',
    },
  });

  return openSignal;
}

async function runTests() {
  console.log('🚀 Starting Phase 1 Integration Tests...');

  const openSignal = await setupTestData();
  console.log(`✅ Seeded active SOL signal ID: ${openSignal.id}`);

  // Test 1: Query Active Signals
  console.log('\n--- Test 1: Query Active Signals ---');
  const activeResponse = await processMemberMessage(TEST_MEMBER_ID, 'active');
  console.log(activeResponse);
  if (!activeResponse.includes('SOL') || !activeResponse.includes('TestMaster')) {
    throw new Error('Test 1 Failed: Active signals query response is incorrect');
  }
  console.log('✅ Test 1 Passed!');

  // Test 2: Query Admin Leaderboard Stats
  console.log('\n--- Test 2: Query Admin Leaderboard Stats ---');
  const statsResponse = await processMemberMessage(TEST_MEMBER_ID, 'stats');
  console.log(statsResponse);
  if (!statsResponse.includes('TestMaster') || !statsResponse.includes('85.5%')) {
    throw new Error('Test 2 Failed: Stats query response is incorrect');
  }
  console.log('✅ Test 2 Passed!');

  // Test 3: Log Taken Trade
  console.log('\n--- Test 3: Log Taken Trade ---');
  const tradeResponse = await processMemberMessage(TEST_MEMBER_ID, 'took SOL');
  console.log(tradeResponse);
  if (!tradeResponse.includes('Trade Registered') || !tradeResponse.includes('SOL')) {
    throw new Error('Test 3 Failed: Trade registration response is incorrect');
  }

  // Verify DB record
  const member = await prisma.member.findUnique({
    where: { whatsappNumber: TEST_MEMBER_ID },
    include: {
      trades: true,
    },
  });
  if (!member || member.trades.length !== 1 || member.trades[0].signalId !== openSignal.id) {
    throw new Error('Test 3 Failed: MemberTrade database record was not created correctly');
  }
  console.log('✅ Test 3 Passed!');

  // Test 4: Conversational Freeform Query (Groq Llama 3.3)
  console.log('\n--- Test 4: Conversational Freeform Query (Groq) ---');
  if (!process.env.GROQ_API_KEY) {
    console.log('⚠️ Skipping Groq conversational test because GROQ_API_KEY is not defined in .env');
  } else {
    const groqResponse = await processMemberMessage(TEST_MEMBER_ID, 'Explain what leverage in crypto trading is in 1 sentence.');
    console.log(`🤖 Groq Answer:\n"${groqResponse}"`);
    if (!groqResponse || groqResponse.trim().length === 0 || groqResponse.includes('Signum Error')) {
      throw new Error('Test 4 Failed: Conversational reply from Groq is invalid or errored');
    }
    console.log('✅ Test 4 Passed!');
  }

  // Test 5: Price Watcher TP resolution
  console.log('\n--- Test 5: Price Watcher TP Resolution ---');
  // Set live price to TP hit target: 170 (tpPrice is 165)
  setMockPrice('SOL', 170);
  await checkPricesOnce();

  // Verify status updated in DB
  const signalAfterTp = await prisma.signal.findUnique({
    where: { id: openSignal.id },
  });
  if (!signalAfterTp || signalAfterTp.status !== 'TP_HIT' || !signalAfterTp.resolvedAt) {
    throw new Error('Test 5 Failed: Signal status was not updated to TP_HIT in DB');
  }
  console.log('✅ Test 5 Passed!');

  // Test 6: Price Watcher SL resolution
  console.log('\n--- Test 6: Price Watcher SL Resolution ---');
  // Re-open signal to test SL hit
  const openSignal2 = await prisma.signal.create({
    data: {
      adminId: TEST_ADMIN_ID,
      asset: 'ETH',
      direction: 'BUY',
      entryMin: 1800,
      entryMax: 1850,
      tpPercent: 10,
      slPercent: 5,
      tpPrice: 2035,
      slPrice: 1710, // 1800 * 0.95
      rrRatio: 2,
      urgencyScore: 9,
      status: 'ENTRY_OPEN',
      rawText: 'ETH Buy: 1800 - 1850 Target: 10% Stop: 5%',
    },
  });

  // Set live price to SL hit target: 1650 (slPrice is 1710)
  setMockPrice('ETH', 1650);
  await checkPricesOnce();

  // Verify status updated in DB
  const signalAfterSl = await prisma.signal.findUnique({
    where: { id: openSignal2.id },
  });
  if (!signalAfterSl || signalAfterSl.status !== 'SL_HIT' || !signalAfterSl.resolvedAt) {
    throw new Error('Test 6 Failed: Signal status was not updated to SL_HIT in DB');
  }
  console.log('✅ Test 6 Passed!');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Phase 1 execution verified.');
}

runTests()
  .catch(err => {
    console.error('\n❌ Integration Tests Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
