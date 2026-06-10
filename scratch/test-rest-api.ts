import { startApiServer } from '../src/api/server';
import { prisma } from '../src/db/src/index';

async function runTests() {
  console.log('🧪 Starting API Integration Tests...');

  // Start the server
  const server = startApiServer();
  const baseUrl = 'http://127.0.0.1:3000';

  try {
    // Setup clean test entities
    const testAdminId = 'test_admin_jid@s.whatsapp.net';
    const testMemberPhone = '9999999999';

    // Cleanup previous test state if any
    await prisma.memberTrade.deleteMany({
      where: { member: { whatsappNumber: testMemberPhone } }
    });
    await prisma.member.deleteMany({
      where: { whatsappNumber: testMemberPhone }
    });
    await prisma.signal.deleteMany({
      where: { adminId: testAdminId }
    });
    await prisma.admin.deleteMany({
      where: { id: testAdminId }
    });

    // Create a test admin
    await prisma.admin.create({
      data: {
        id: testAdminId,
        name: 'Test Admin',
        winRate: 80.0,
        totalSignals: 5,
        totalWins: 4
      }
    });

    // Create some test signals
    const activeSignal = await prisma.signal.create({
      data: {
        adminId: testAdminId,
        asset: 'BTC',
        direction: 'BUY',
        entryMin: 60000,
        entryMax: 61000,
        tpPercent: 5,
        slPercent: 3,
        tpPrice: 63000,
        slPrice: 58200,
        rrRatio: 1.67,
        status: 'ENTRY_OPEN',
        rawText: 'BUY BTC entry 60000-61000',
        livePriceAtPost: 60500
      }
    });

    const winSignal = await prisma.signal.create({
      data: {
        adminId: testAdminId,
        asset: 'ETH',
        direction: 'BUY',
        entryMin: 3000,
        entryMax: 3100,
        tpPercent: 10,
        slPercent: 5,
        tpPrice: 3300,
        slPrice: 2850,
        rrRatio: 2.0,
        status: 'TP_HIT',
        rawText: 'BUY ETH entry 3000-3100',
        livePriceAtPost: 3050,
        resolvedAt: new Date()
      }
    });

    const lossSignal = await prisma.signal.create({
      data: {
        adminId: testAdminId,
        asset: 'SOL',
        direction: 'BUY',
        entryMin: 100,
        entryMax: 110,
        tpPercent: 20,
        slPercent: 10,
        tpPrice: 120,
        slPrice: 90,
        rrRatio: 2.0,
        status: 'SL_HIT',
        rawText: 'BUY SOL entry 100-110',
        livePriceAtPost: 105,
        resolvedAt: new Date()
      }
    });

    // Test 1: GET /signals/active
    console.log('🔍 Test 1: GET /signals/active...');
    const activeRes = await fetch(`${baseUrl}/signals/active`);
    const activeData = (await activeRes.json()) as any[];
    if (!Array.isArray(activeData)) throw new Error('Active signals response must be an array');
    const hasActiveTest = activeData.some(s => s.id === activeSignal.id);
    if (!hasActiveTest) throw new Error('Active signal was not returned');
    console.log('   └─ Found active test signal:', activeSignal.id);
    console.log('✅ Test 1 Passed');

    // Test 2: GET /signals/history
    console.log('🔍 Test 2: GET /signals/history...');
    const historyRes = await fetch(`${baseUrl}/signals/history?asset=ETH`);
    const historyData = (await historyRes.json()) as any[];
    if (!Array.isArray(historyData)) throw new Error('History response must be an array');
    const hasWinTest = historyData.some(s => s.id === winSignal.id);
    if (!hasWinTest) throw new Error('History signal ETH not found with filter');
    const hasLossTest = historyData.some(s => s.id === lossSignal.id);
    if (hasLossTest) throw new Error('Loss signal (SOL) should not be returned with asset=ETH filter');
    console.log('   └─ Found win history signal and successfully filtered out SOL');
    console.log('✅ Test 2 Passed');

    // Test 3: GET /signals/:id
    console.log('🔍 Test 3: GET /signals/:id...');
    const detailRes = await fetch(`${baseUrl}/signals/${activeSignal.id}`);
    const detailData = (await detailRes.json()) as any;
    if (detailData.id !== activeSignal.id) throw new Error('Detail signal ID mismatch');
    console.log('✅ Test 3 Passed');

    // Test 4: GET /admins/stats
    console.log('🔍 Test 4: GET /admins/stats...');
    const statsRes = await fetch(`${baseUrl}/admins/stats`);
    const statsData = (await statsRes.json()) as any[];
    if (!Array.isArray(statsData)) throw new Error('Stats response must be an array');
    const hasAdmin = statsData.some(a => a.id === testAdminId);
    if (!hasAdmin) throw new Error('Test admin stats not found');
    console.log('✅ Test 4 Passed');

    // Test 5: POST /members/register
    console.log('🔍 Test 5: POST /members/register...');
    const regRes = await fetch(`${baseUrl}/members/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsappNumber: testMemberPhone })
    });
    const regData = (await regRes.json()) as any;
    if (!regData.token) throw new Error('Registration did not return token');
    if (regData.member.whatsappNumber !== testMemberPhone) throw new Error('Member whatsappNumber mismatch');
    
    const token = regData.token;
    const memberId = regData.member.id;
    console.log('   └─ Generated token:', token.substring(0, 15) + '...');
    console.log('✅ Test 5 Passed');

    // Test 6: Authenticated Route Protection
    console.log('🔍 Test 6: Authenticated Route Protection...');
    const unauthRes = await fetch(`${baseUrl}/members/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertsEnabled: false })
    });
    if (unauthRes.status !== 401) throw new Error('Route should require authorization header (expected 401)');
    console.log('✅ Test 6 Passed');

    // Test 7: PUT /members/preferences (Authenticated)
    console.log('🔍 Test 7: PUT /members/preferences...');
    const prefRes = await fetch(`${baseUrl}/members/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ alertsEnabled: false, fcmToken: 'test_fcm_token_xyz' })
    });
    const prefData = (await prefRes.json()) as any;
    if (prefData.member.alertsEnabled !== false) throw new Error('Alert preference update failed');
    if (prefData.member.fcmToken !== 'test_fcm_token_xyz') throw new Error('FCM Token update failed');
    console.log('✅ Test 7 Passed');

    // Test 8: POST /members/trade/:signalId (Take trades)
    console.log('🔍 Test 8: POST /members/trade/:signalId...');
    // Take trade on active signal
    const tradeActiveRes = await fetch(`${baseUrl}/members/trade/${activeSignal.id}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (tradeActiveRes.status !== 201) throw new Error('Failed to register active signal trade');

    // Take trade on resolved win signal
    const tradeWinRes = await fetch(`${baseUrl}/members/trade/${winSignal.id}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (tradeWinRes.status !== 201) throw new Error('Failed to register win signal trade');

    // Take trade on resolved loss signal
    const tradeLossRes = await fetch(`${baseUrl}/members/trade/${lossSignal.id}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (tradeLossRes.status !== 201) throw new Error('Failed to register loss signal trade');
    console.log('✅ Test 8 Passed');

    // Test 9: GET /members/:id/portfolio (Portfolio and P&L)
    console.log('🔍 Test 9: GET /members/:id/portfolio...');
    const portRes = await fetch(`${baseUrl}/members/${memberId}/portfolio`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const portData = (await portRes.json()) as any;
    if (portData.totalTrades !== 3) throw new Error(`Expected 3 total trades, got ${portData.totalTrades}`);
    if (portData.winCount !== 1) throw new Error(`Expected 1 win count, got ${portData.winCount}`);
    if (portData.lossCount !== 1) throw new Error(`Expected 1 loss count, got ${portData.lossCount}`);
    
    // completedPnL should be win (10%) - loss (5%) = 5%
    const expectedPnL = winSignal.tpPercent - lossSignal.slPercent;
    if (portData.completedPnLPercent !== expectedPnL) {
      throw new Error(`Expected completed P&L to be ${expectedPnL}%, got ${portData.completedPnLPercent}%`);
    }

    // Active trade floating P&L verification
    const activeTrade = portData.activeTrades[0];
    if (!activeTrade) throw new Error('Floating active trade not returned in portfolio');
    if (activeTrade.asset !== 'BTC') throw new Error('Active trade asset mismatch');
    console.log(`   └─ Active Trade Floating P&L: ${activeTrade.floatingPnL}% (Current Price: ${activeTrade.currentPrice})`);
    console.log('✅ Test 9 Passed');

    // Test 10: Resource Ownership Check (Access another member's portfolio)
    console.log('🔍 Test 10: Resource Ownership Check...');
    const badPortRes = await fetch(`${baseUrl}/members/another_member_id_abc/portfolio`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (badPortRes.status !== 403) throw new Error('Expected 403 Forbidden when accessing another member\'s portfolio');
    console.log('✅ Test 10 Passed');

    // Clean up test data
    await prisma.memberTrade.deleteMany({
      where: { member: { whatsappNumber: testMemberPhone } }
    });
    await prisma.member.deleteMany({
      where: { whatsappNumber: testMemberPhone }
    });
    await prisma.signal.deleteMany({
      where: { adminId: testAdminId }
    });
    await prisma.admin.deleteMany({
      where: { id: testAdminId }
    });

    console.log('🎉 ALL REST API END-TO-END INTEGRATION TESTS PASSED!');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('❌ Integration Tests Failed:', err);
  process.exit(1);
});
