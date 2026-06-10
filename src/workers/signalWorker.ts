import { Worker } from 'bullmq';
import { runSignalAgent } from '../agent';
import { getAdminContext } from '../services/db';
import { redisConnection } from '../config/redis';

export const signalWorker = new Worker(
  'signals',
  async (job) => {
    const { type, text, adminId, messageId } = job.data;

    if (type !== 'PROCESS_NEW_MESSAGE') {
      console.log(`⚙️ Worker skipping job type: ${type}`);
      return;
    }

    console.log(`⚙️ Worker processing signal job [${job.id}] for admin [${adminId}]`);

    try {
      // Build context for the agent from database
      const context = await getAdminContext(adminId);

      console.log(`⚙️ Starting agent run for ${context.adminName}...`);

      await runSignalAgent(text, adminId, context, messageId);

      console.log(`✅ Job [${job.id}] processed successfully`);
    } catch (error: any) {
      console.error(`❌ Worker failed to process job [${job.id}]:`, error.message);
      throw error; // Re-throw to trigger retry options
    }
  },
  {
    connection: redisConnection as any, // Cast to any to bypass ioredis/bullmq typescript compatibility quirks
    concurrency: 2, // Process up to 2 jobs concurrently
  }
);

signalWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

signalWorker.on('completed', (job) => {
  console.log(`✨ Worker finished job ${job?.id}`);
});
