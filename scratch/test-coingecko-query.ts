import * as dotenv from 'dotenv';
dotenv.config({ override: true });

process.env.NODE_ENV = 'test';

import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/db/src/index';
import { resolveCoingeckoId } from '../src/services/coingecko';
import { saveSignalToDB, processAdminCoingeckoChoice } from '../src/services/db';
import { getLiveOHLC, setMockPrice } from '../src/services/binance';
import { formatWhatsappNumber } from '../src/utils/formatter';

const TEST_ADMIN_ID = 'proof_admin@s.whatsapp.net';
const TEST_MEMBER_ID = 'proof_member@s.whatsapp.net';
const originalFetch = global.fetch;

async function testCoinGeckoQueryFix() {
  console.log('🧪 Starting CoinGecko Query & Dynamic ID Resolution Tests...');

  // Mock global fetch for CoinGecko API calls
  global.fetch = (async (url: any) => {
    const urlStr = url.toString();
    console.log(`📡 Mocked fetch intercepted request to: ${urlStr}`);

    if (urlStr.includes('/coins/list')) {
      return {
        status: 200,
        ok: true,
        json: async () => [
          { id: 'c-chain', symbol: 'c', name: 'C-Chain' },
          { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
          { id: 'other-c-token', symbol: 'c', name: 'Other C Token' }
        ]
      } as Response;
    }

    if (urlStr.includes('/simple/price')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          'c-chain': { usd: 0.10325 },
          'other-c-token': { usd: 5.50 }
        })
      } as Response;
    }

    if (urlStr.includes('/ohlc')) {
      return {
        status: 200,
        ok: true,
        json: async () => [
          [Date.now(), 0.10325, 0.10325, 0.10325, 0.10325]
        ]
      } as Response;
    }

    return {
      status: 404,
      ok: false,
      text: async () => 'Not Found'
    } as Response;
  }) as any;

  // Setup mock price for binance service
  setMockPrice('C', 0.10325);

  const dbAdmin = await prisma.admin.upsert({
    where: { id: TEST_ADMIN_ID },
    create: { id: TEST_ADMIN_ID, name: 'ProofAdmin' },
    update: {},
  });

  const dbMember = await prisma.member.upsert({
    where: { whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID) },
    create: { whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID) },
    update: {},
  });

  // Clean up existing signals for C
  await prisma.signal.deleteMany({
    where: { OR: [{ asset: 'C' }, { adminId: TEST_ADMIN_ID }] }
  });

  try {
    // ── STEP 1: Verify Dynamic Resolution of 'C' symbol ──
    console.log('\n🔍 STEP 1: Testing resolveCoingeckoId for symbol "C"...');
    const resolvedId = await resolveCoingeckoId('C', 0.101, 0.1055);
    console.log(`   └─ Resolved CoinGecko ID: ${resolvedId}`);
    
    if (resolvedId !== 'c-chain') {
      throw new Error(`Expected resolved ID to be "c-chain", got "${resolvedId}"`);
    }
    console.log('✅ CoinGecko symbol "C" successfully resolved to "c-chain" using price matching!');

    // ── STEP 2: Verify Saving to DB with resolved coingeckoId ──
    console.log('\n💾 STEP 2: Saving signal to database...');
    const signalId = await saveSignalToDB({
      adminId: TEST_ADMIN_ID,
      asset: 'C',
      direction: 'BUY',
      entryMin: 0.101,
      entryMax: 0.1055,
      tpPercent: 10,
      slPercent: 7,
      tpPrice: 0.115,
      slPrice: 0.0939,
      rrRatio: 1.43,
      urgencyScore: 8,
      rawText: 'BUY C at 0.101--0.1055, Target: 10-30%, Stoploss: 7% from minimum entry.',
      messageId: 'msg-coingecko-c-123'
    });

    const savedSignal = await prisma.signal.findUnique({
      where: { id: signalId }
    });

    if (!savedSignal || savedSignal.status !== 'PENDING' || savedSignal.coingeckoId !== null) {
      throw new Error(`Expected signal to be saved as PENDING with null coingeckoId, got status: "${savedSignal?.status}", coingeckoId: "${savedSignal?.coingeckoId}"`);
    }
    console.log('✅ Signal successfully saved to database with status PENDING!');

    // Verify candidates are stored in enrichment
    const enrichment = savedSignal.enrichment as any;
    if (!enrichment || !Array.isArray(enrichment.coingeckoCandidates) || enrichment.coingeckoCandidates.length !== 2) {
      throw new Error('Expected 2 coingecko candidates in enrichment');
    }
    console.log('✅ Found multiple coingecko candidates saved in signal enrichment!');

    // ── STEP 2.5: Simulate choice reply ──
    console.log('\n💬 Simulating admin choice reply "1" (C-Chain)...');
    const processed = await processAdminCoingeckoChoice(TEST_ADMIN_ID, '1');
    if (!processed) {
      throw new Error('Choice processing returned false');
    }

    const updatedSignal = await prisma.signal.findUnique({
      where: { id: signalId }
    });

    if (!updatedSignal || updatedSignal.status !== 'ENTRY_OPEN' || updatedSignal.coingeckoId !== 'c-chain') {
      throw new Error(`Expected updated signal to be ENTRY_OPEN with coingeckoId "c-chain", got status: "${updatedSignal?.status}", coingeckoId: "${updatedSignal?.coingeckoId}"`);
    }
    console.log('✅ Signal successfully activated with coingeckoId "c-chain" via choice resolution!');

    // ── STEP 3: Verify getLiveOHLC queries coingeckoId ──
    console.log('\n📈 STEP 3: Fetching OHLC using the resolved coingeckoId...');
    
    // Clear the mockPrice override to force API path execution
    setMockPrice('C', null);

    const candles = await getLiveOHLC('C', updatedSignal.coingeckoId);
    console.log(`   └─ Retrieved candles count: ${candles?.length}`);

    // Verify it doesn't fail/nullify
    if (!candles || candles.length === 0) {
      throw new Error('OHLC fetch returned null/empty candles');
    }

    console.log('✅ OHLC data successfully fetched using the mapped coingeckoId!');
    console.log('\n🎉 ALL COINGECKO QUERY RESOLUTION AND DB VERIFICATION TESTS PASSED!');
    process.exit(0);

  } catch (error: any) {
    console.error('\n❌ Test failed with error:', error.message);
    process.exit(1);
  } finally {
    global.fetch = originalFetch;
    // Clean up
    await prisma.signal.deleteMany({ where: { adminId: TEST_ADMIN_ID } });
    await prisma.member.deleteMany({ where: { id: dbMember.id } });
    await prisma.admin.delete({ where: { id: TEST_ADMIN_ID } });
    await prisma.$disconnect();
  }
}

testCoinGeckoQueryFix();
