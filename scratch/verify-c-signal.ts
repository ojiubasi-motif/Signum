import * as dotenv from 'dotenv';
dotenv.config({ override: true });
process.env.NODE_ENV = 'test';

import { prisma } from '../src/db/src/index';
import { setMockPrice } from '../src/services/binance';
import { checkPricesOnce } from '../src/workers/priceWatcher';
import { formatWhatsappNumber } from '../src/utils/formatter';

const TEST_ADMIN_ID = 'proof_admin@s.whatsapp.net';
const TEST_MEMBER_ID = 'proof_member@s.whatsapp.net';

async function runProof() {
  console.log('🧪 Starting proof run for signal C...');

  // Clean up any old proof data
  await prisma.memberTrade.deleteMany({ where: { member: { whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID) } } });
  await prisma.signal.deleteMany({ where: { adminId: TEST_ADMIN_ID } });
  await prisma.member.deleteMany({ where: { whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID) } });
  await prisma.admin.deleteMany({ where: { id: TEST_ADMIN_ID } });

  // 1. Seed Admin and Member
  const admin = await prisma.admin.create({
    data: {
      id: TEST_ADMIN_ID,
      name: 'ProofAdmin',
    },
  });

  const member = await prisma.member.create({
    data: {
      whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID),
    },
  });

  // 2. Parse and Create the Signal
  // Message: "$C entry 0.101--0.1055 Target: 10-30% Stoploss:7%"
  // BUY direction, TP = 30%, SL = 7%
  const entryMin = 0.101;
  const entryMax = 0.1055;
  const tpPercent = 30;
  const slPercent = 7;
  const tpPrice = entryMax * (1 + tpPercent / 100); // 0.1055 * 1.30 = 0.13715
  const slPrice = entryMin * (1 - slPercent / 100); // 0.101 * 0.93 = 0.09393

  const signal = await prisma.signal.create({
    data: {
      adminId: TEST_ADMIN_ID,
      asset: 'C',
      direction: 'BUY',
      entryMin,
      entryMax,
      tpPercent,
      slPercent,
      tpPrice,
      slPrice,
      rrRatio: Number((tpPercent / slPercent).toFixed(2)),
      status: 'ENTRY_OPEN',
      rawText: '$C entry 0.101--0.1055\nTarget: 10-30%\nStoploss:7% from minimum entry.',
    },
  });

  // Create a taken trade
  const trade = await prisma.memberTrade.create({
    data: {
      memberId: member.id,
      signalId: signal.id,
    },
  });

  console.log('\n📥 Created Database Records:');
  console.log(`- Admin: ${admin.name} (${admin.id})`);
  console.log(`- Member JID Formatted: ${member.whatsappNumber}`);
  console.log(`- Signal ID: ${signal.id}`);
  console.log(`  ├─ Asset: ${signal.asset} (${signal.direction})`);
  console.log(`  ├─ Entry Zone: $${signal.entryMin} - $${signal.entryMax}`);
  console.log(`  ├─ Calculated TP Price (30% from Max): $${signal.tpPrice}`);
  console.log(`  ├─ Calculated SL Price (7% from Min): $${signal.slPrice}`);
  console.log(`  ├─ R:R Ratio: 1:${signal.rrRatio}`);
  console.log(`  └─ Initial Status: ${signal.status}`);
  console.log(`- Member Trade Outcome: ${trade.outcome || 'PENDING'}`);

  // 3. Simulate Price Update to hit Take Profit (0.14)
  console.log('\n📈 Simulating price hit above TP ($0.14)...');
  setMockPrice('C', 0.14);

  // 4. Run Watcher Cycle
  await checkPricesOnce();

  // 5. Query updated results
  const updatedSignal = await prisma.signal.findUnique({ where: { id: signal.id } });
  const updatedTrade = await prisma.memberTrade.findUnique({ where: { id: trade.id } });
  const updatedAdmin = await prisma.admin.findUnique({ where: { id: TEST_ADMIN_ID } });

  console.log('\n🎯 Results After Watcher Cycle:');
  console.log(`- Signal Status: ${updatedSignal?.status}`);
  console.log(`- Member Trade Outcome: ${updatedTrade?.outcome}`);
  console.log(`- Admin Stats:`);
  console.log(`  ├─ Total Signals: ${updatedAdmin?.totalSignals}`);
  console.log(`  ├─ Total Wins: ${updatedAdmin?.totalWins}`);
  console.log(`  └─ Win Rate: ${updatedAdmin?.winRate}%`);

  // Clean up
  await prisma.memberTrade.deleteMany({ where: { member: { whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID) } } });
  await prisma.signal.deleteMany({ where: { adminId: TEST_ADMIN_ID } });
  await prisma.member.deleteMany({ where: { whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID) } });
  await prisma.admin.deleteMany({ where: { id: TEST_ADMIN_ID } });
}

runProof()
  .then(() => console.log('\n🎉 Proof complete!'))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
