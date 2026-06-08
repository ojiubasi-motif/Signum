import { signalQueue } from '../src/queue';
import { redisConnection } from '../src/config/redis';

async function runCheck() {
  console.log('Checking BullMQ queue for waiting/active jobs...');
  
  try {
    const jobs = await signalQueue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
    console.log(`Total jobs found: ${jobs.length}`);
    
    for (const job of jobs) {
      console.log(`\n📦 Job ID: ${job.id}`);
      console.log(`   ├─ State:     ${await job.getState()}`);
      console.log(`   ├─ Name:      ${job.name}`);
      console.log(`   ├─ Timestamp: ${new Date(job.timestamp).toLocaleString()}`);
      console.log(`   └─ Data:      ${JSON.stringify(job.data, null, 2)}`);
    }

  } catch (error) {
    console.error('Check failed:', error);
  } finally {
    await redisConnection.quit();
    await signalQueue.close();
  }
}

runCheck();
