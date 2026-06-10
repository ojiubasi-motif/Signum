import { prisma } from '../src/db/src/index';

async function main() {
  const signalCounts = await prisma.signal.groupBy({
    by: ['status'],
    _count: { id: true }
  });
  console.log('Signal counts by status:', JSON.stringify(signalCounts, null, 2));

  const allAssets = await prisma.signal.groupBy({
    by: ['asset', 'status'],
    _count: { id: true }
  });
  console.log('Signal assets and status:', JSON.stringify(allAssets, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
