import { prisma } from '../src/db/src/index';

async function main() {
  console.log('🔄 Recalculating admin statistics...');
  const admins = await prisma.admin.findMany();

  for (const admin of admins) {
    const allSignals = await prisma.signal.findMany({
      where: { adminId: admin.id }
    });

    const totalSignals = allSignals.filter(s => s.status !== 'EXPIRED' && s.status !== 'PENDING').length;
    const totalWins = allSignals.filter(s => s.status === 'TP_HIT').length;
    const resolvedTradeSignals = allSignals.filter(s => s.status === 'TP_HIT' || s.status === 'SL_HIT').length;
    const winRate = resolvedTradeSignals > 0 ? (totalWins / resolvedTradeSignals) * 100 : 0;

    console.log(`👤 Admin: ${admin.name} (${admin.id})`);
    console.log(`   ├─ Before: Signals=${admin.totalSignals}, Wins=${admin.totalWins}, WinRate=${admin.winRate.toFixed(1)}%`);
    console.log(`   └─ After:  Signals=${totalSignals}, Wins=${totalWins}, WinRate=${winRate.toFixed(1)}%`);

    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        totalSignals,
        totalWins,
        winRate
      }
    });
  }

  console.log('✅ Recalculation complete!');
}

main().catch(err => {
  console.error('❌ Error recalculating stats:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
