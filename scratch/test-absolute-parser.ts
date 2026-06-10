import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import { prisma } from '../src/db/src/index';
import { runSignalAgent } from '../src/agent';
import { setMockPrice } from '../src/services/binance';

const TEST_ADMIN_ID = 'proof_admin@s.whatsapp.net';

async function testParser() {
  console.log('🧪 Testing Groq Agent parsing for absolute target/stoploss signal...');

  // Setup mock price for BTC to avoid real api calls during agent lookup
  setMockPrice('BTC', 63774.5);

  // Ensure test admin exists
  await prisma.admin.upsert({
    where: { id: TEST_ADMIN_ID },
    create: { id: TEST_ADMIN_ID, name: 'ProofAdmin' },
    update: {},
  });

  // Delete any pre-existing signals for BTC under this admin
  await prisma.signal.deleteMany({
    where: { adminId: TEST_ADMIN_ID, asset: 'BTC' },
  });

  const signalText = 'BUY BTC at 63774-63775, Target: 63780, Stoploss: 63765';
  
  try {
    await runSignalAgent(signalText, TEST_ADMIN_ID, {
      adminName: 'ProofAdmin',
      adminWinRate: 100,
      openSignals: [],
    });

    console.log('\n🔍 Fetching signal from DB to inspect calculations...');
    const savedSignal = await prisma.signal.findFirst({
      where: { adminId: TEST_ADMIN_ID, asset: 'BTC' },
      orderBy: { createdAt: 'desc' },
    });

    if (!savedSignal) {
      throw new Error('❌ Test Failed: Signal was not saved to DB!');
    }

    console.log('✅ Signal Saved Successfully!');
    console.log(`- ID: ${savedSignal.id}`);
    console.log(`- Asset: ${savedSignal.asset}`);
    console.log(`- Direction: ${savedSignal.direction}`);
    console.log(`- Entry Zone: $${savedSignal.entryMin} - $${savedSignal.entryMax}`);
    console.log(`- TP Price: $${savedSignal.tpPrice} (Derived Percent: ${savedSignal.tpPercent.toFixed(4)}%)`);
    console.log(`- SL Price: $${savedSignal.slPrice} (Derived Percent: ${savedSignal.slPercent.toFixed(4)}%)`);
    console.log(`- R:R Ratio: 1:${savedSignal.rrRatio}`);

    // Assert absolute values
    if (savedSignal.tpPrice !== 63780) {
      throw new Error(`❌ Target price mismatch: Expected 63780, Got ${savedSignal.tpPrice}`);
    }
    if (savedSignal.slPrice !== 63765) {
      throw new Error(`❌ Stoploss price mismatch: Expected 63765, Got ${savedSignal.slPrice}`);
    }
    console.log('\n🎉 ALL CALCULATIONS VERIFIED SUCCESSFULLY!');
  } catch (error: any) {
    console.error('❌ Error during test:', error.message);
  } finally {
    // Clean up
    await prisma.signal.deleteMany({
      where: { adminId: TEST_ADMIN_ID, asset: 'BTC' },
    });
    await prisma.admin.delete({ where: { id: TEST_ADMIN_ID } });
    await prisma.$disconnect();
  }
}

testParser();
