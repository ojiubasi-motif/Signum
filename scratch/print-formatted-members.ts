import { prisma } from '../src/db/src/index';
import { formatWhatsappNumber } from '../src/utils/formatter';

async function run() {
  const members = await prisma.member.findMany();
  console.log(`\n📋 Current Database Members (${members.length} found):`);
  console.log('----------------------------------------------------');
  for (const member of members) {
    const raw = member.whatsappNumber;
    const formatted = formatWhatsappNumber(raw);
    console.log(`Raw: ${raw.padEnd(45)} => Formatted: ${formatted}`);
  }
  console.log('----------------------------------------------------\n');
}

run()
  .catch(err => {
    console.error('❌ Error executing print-formatted-members:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
