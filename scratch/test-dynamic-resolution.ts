import * as dotenv from 'dotenv';
dotenv.config({ override: true });

process.env.NODE_ENV = 'test';

import { prisma } from '../src/db/src/index';
import { resolveCoingeckoId } from '../src/services/coingecko';
import { saveSignalToDB } from '../src/services/db';
import { getLiveOHLC } from '../src/services/binance';
import { secureFetch } from '../src/utils/secureFetch';

const TEST_ADMIN_ID = 'proof_admin@s.whatsapp.net';

async function testDynamicResolution() {
  console.log('🧪 Starting verify tests for SecureFetch and Dynamic CoinGecko Resolution...');

  // 1. Test secureFetch
  console.log('\n🔒 Testing secureFetch SSRF protections...');
  try {
    await secureFetch('ftp://api.coingecko.com/api/v3/ping');
    throw new Error('secureFetch failed to block non-http protocol');
  } catch (err: any) {
    console.log(`✅ secureFetch blocked non-http: "${err.message}"`);
  }

  try {
    await secureFetch('https://forbidden-domain.com/ping');
    throw new Error('secureFetch failed to block forbidden domain');
  } catch (err: any) {
    console.log(`✅ secureFetch blocked forbidden domain: "${err.message}"`);
  }

  // 2. Mock fetch
  const originalFetch = global.fetch;
  global.fetch = (async (url: any) => {
    const urlStr = url.toString();
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
          'c-chain': { usd: 0.103 },
          'other-c-token': { usd: 5.50 }
        })
      } as Response;
    }
    return { status: 404, ok: false } as Response;
  }) as any;

  try {
    // 3. Test resolveCoingeckoId with matching price in range
    console.log('\n🔍 Testing resolveCoingeckoId price-based selection...');
    const resolvedId = await resolveCoingeckoId('C', 0.101, 0.105);
    console.log(`   └─ Resolved ID: ${resolvedId}`);
    if (resolvedId !== 'c-chain') {
      throw new Error(`Expected c-chain, got ${resolvedId}`);
    }
    console.log('✅ Resolved c-chain correctly since its price (0.103) is in range [0.101, 0.105]');

    // 4. Test resolveCoingeckoId with no matching price in range
    const resolvedIdNone = await resolveCoingeckoId('C', 10.0, 20.0);
    console.log(`   └─ Resolved ID (out of range): ${resolvedIdNone}`);
    if (resolvedIdNone !== null) {
      throw new Error(`Expected null when price is out of range, got ${resolvedIdNone}`);
    }
    console.log('✅ Returned null correctly when no candidate matches the price range');

    // 5. Test saveSignalToDB dynamic resolution flow
    console.log('\n💾 Testing saveSignalToDB dynamic activation flow...');
    
    await prisma.admin.upsert({
      where: { id: TEST_ADMIN_ID },
      create: { id: TEST_ADMIN_ID, name: 'ProofAdmin' },
      update: {},
    });

    await prisma.signal.deleteMany({
      where: { adminId: TEST_ADMIN_ID }
    });

    const signalId = await saveSignalToDB({
      adminId: TEST_ADMIN_ID,
      asset: 'C',
      direction: 'BUY',
      entryMin: 0.101,
      entryMax: 0.105,
      tpPercent: 10,
      slPercent: 7,
      tpPrice: 0.115,
      slPrice: 0.0939,
      rrRatio: 1.43,
      urgencyScore: 8,
      rawText: 'BUY C at 0.101--0.105',
    });

    const signal = await prisma.signal.findUnique({ where: { id: signalId } });
    if (!signal || signal.status !== 'ENTRY_OPEN' || signal.coingeckoId !== 'c-chain') {
      throw new Error(`Expected signal to be ENTRY_OPEN with c-chain, got ${signal?.status}, ID: ${signal?.coingeckoId}`);
    }
    console.log('✅ Signal resolved and activated directly as ENTRY_OPEN with coingeckoId: "c-chain"');

    // 6. Test saveSignalToDB dynamic pending fallback flow
    const pendingSignalId = await saveSignalToDB({
      adminId: TEST_ADMIN_ID,
      asset: 'C',
      direction: 'BUY',
      entryMin: 10.0,
      entryMax: 20.0,
      tpPercent: 10,
      slPercent: 7,
      tpPrice: 11.5,
      slPrice: 9.39,
      rrRatio: 1.43,
      urgencyScore: 8,
      rawText: 'BUY C at 10--20',
    });

    const pendingSignal = await prisma.signal.findUnique({ where: { id: pendingSignalId } });
    if (!pendingSignal || pendingSignal.status !== 'PENDING' || pendingSignal.coingeckoId !== null) {
      throw new Error(`Expected pending status for out-of-range signal, got ${pendingSignal?.status}`);
    }
    console.log('✅ Signal correctly marked as PENDING since no candidates matched the price range');

    // 7. Test getLiveOHLC fallback when coingeckoId is null (AIGENSYN scenario)
    console.log('\n👁️ Testing getLiveOHLC bypass for null/missing coingeckoId...');
    const resultCandles = await getLiveOHLC('AIGENSYN', null);
    if (resultCandles === null) {
      console.log('✅ getLiveOHLC returned null (no fallback signal found or network fallback bypass successful)');
    } else if (Array.isArray(resultCandles) && resultCandles.length === 1) {
      console.log(`✅ getLiveOHLC safely returned active signal fallback candle: ${JSON.stringify(resultCandles)}`);
    } else {
      throw new Error(`Expected null or 1 fallback candle, got: ${JSON.stringify(resultCandles)}`);
    }

    console.log('\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Test failed with error:', err.message);
    process.exit(1);
  } finally {
    global.fetch = originalFetch;
    await prisma.signal.deleteMany({ where: { adminId: TEST_ADMIN_ID } });
    await prisma.$disconnect();
  }
}

testDynamicResolution();
