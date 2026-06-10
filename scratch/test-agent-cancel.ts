import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { runSignalAgent } from '../src/agent';
import { getAdminContext } from '../src/services/db';
import { prisma } from '../src/db/src/index';

async function testCancel() {
  const adminId = 'proof_admin@s.whatsapp.net';
  
  // Clean up and create standard test admin
  await prisma.signal.deleteMany({ where: { adminId } });
  await prisma.admin.upsert({
    where: { id: adminId },
    update: { name: 'ProofAdmin' },
    create: { id: adminId, name: 'ProofAdmin' },
  });

  // Create active "C" signal
  const signal = await prisma.signal.create({
    data: {
      adminId,
      asset: 'C',
      direction: 'BUY',
      entryMin: 0.101,
      entryMax: 0.1055,
      tpPercent: 30,
      slPercent: 7,
      tpPrice: 0.137,
      slPrice: 0.093,
      rrRatio: 4.28,
      status: 'ENTRY_OPEN',
      rawText: 'BUY C at 0.101-0.1055',
    }
  });
  console.log(`Signal C created with ID: ${signal.id}, status: ${signal.status}`);

  const context = await getAdminContext(adminId);
  console.log('Open signals context:', JSON.stringify(context.openSignals));

  // Run agent with "closed C trade"
  const testMessage = 'closed C trade';
  console.log(`\n🤖 Running agent with: "${testMessage}"...`);
  await runSignalAgent(testMessage, adminId, context);

  // Check updated signal status
  const updated = await prisma.signal.findUnique({
    where: { id: signal.id }
  });
  console.log(`\nUpdated signal C status: ${updated?.status}`);
}

testCancel().catch(console.error).finally(() => prisma.$disconnect());
