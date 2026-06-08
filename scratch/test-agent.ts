import * as dotenv from 'dotenv';
import * as path from 'path';
const result = dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
if (result.error) {
  console.error('❌ Dotenv load error:', result.error);
}


import { runSignalAgent } from '../src/agent';
import { getAdminContext } from '../src/services/db';
import { redisConnection } from '../src/config/redis';
import { signalQueue } from '../src/queue';

async function testAgent() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.includes('your-groq-api-key-here') || apiKey === '') {
    console.error('❌ Error: GROQ_API_KEY is not set in .env!');
    console.error('👉 Please edit your .env file and paste a valid Groq API key.');
    process.exit(1);
  }

  console.log('🧪 Starting agent integration test...');

  const testMessage = `ETH\nBUY: 1800 - 1850\nTP: 12%\nSL: 8%`;
  const adminId = '180740897673374@lid'; // LID from your WhatsApp account

  try {
    // 1. Fetch admin context (this creates the admin in db if missing)
    const context = await getAdminContext(adminId);
    console.log(`👤 Admin Context loaded: ${JSON.stringify(context)}`);

    // 2. Execute agent loop
    console.log(`🤖 Invoking agent with mock signal:\n"${testMessage}"`);
    await runSignalAgent(testMessage, adminId, context);

    console.log('🎉 Test finished successfully!');
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    await redisConnection.quit();
    await signalQueue.close();
  }
}

testAgent();
