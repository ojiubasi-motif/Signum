import { signalQueue } from '../src/queue';
import { redisConnection } from '../src/config/redis';

async function runTest() {
  console.log('Testing Redis connection and BullMQ queue...');
  
  try {
    // Check Redis ping
    const pingResult = await redisConnection.ping();
    console.log(`Redis Ping Result: ${pingResult}`);
    
    // Check jobs before adding
    const initialJobs = await signalQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
    console.log(`Initial jobs in queue: ${initialJobs.length}`);
    
    // Add a test job
    const job = await signalQueue.add('signal', {
      type: 'PROCESS_NEW_MESSAGE',
      text: 'BUY BTC Entry: 94000 - 95000 TP: 10% SL: 7%',
      adminId: '1234567890@s.whatsapp.net',
      messageId: 'test-msg-id-123',
      timestamp: Math.floor(Date.now() / 1000)
    });
    
    console.log(`Successfully added job with ID: ${job.id}`);
    
    // Retrieve jobs after adding
    const currentJobs = await signalQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
    console.log(`Current jobs in queue: ${currentJobs.length}`);
    for (const j of currentJobs) {
      console.log(`- Job ID: ${j.id}, Name: ${j.name}, Data: ${JSON.stringify(j.data)}`);
      // Remove job to clean up
      await j.remove();
      console.log(`  Removed job ${j.id}`);
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Close connections to exit process
    await redisConnection.quit();
    await signalQueue.close();
  }
}

runTest();
