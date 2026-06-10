import { prisma } from '../src/db/src/index';

async function main() {
  const cSignals = await prisma.signal.findMany({
    where: {
      asset: {
        equals: 'C',
        mode: 'insensitive'
      }
    }
  });
  console.log('--- C Signals ---');
  console.log(JSON.stringify(cSignals, null, 2));

  const recent = await prisma.signal.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
  });
  console.log('--- Recent 5 Signals ---');
  console.log(JSON.stringify(recent.map(r => ({
    id: r.id,
    asset: r.asset,
    status: r.status,
    createdAt: r.createdAt
  })), null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
