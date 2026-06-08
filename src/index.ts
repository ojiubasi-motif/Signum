import { startBot } from './bot';
import { signalWorker } from './workers/signalWorker';
import { startPriceWatcher } from './workers/priceWatcher';

console.log('🚀 Starting Signum Bot...');
console.log('⚙️ Starting BullMQ Signal Worker...');
console.log('⚙️ Starting Price Watcher...');

// Reference worker to ensure it initializes and runs
const worker = signalWorker;

// Start price watcher loop at 5-minute interval (300,000 ms)
startPriceWatcher(300000);

startBot().catch(err => {
  console.error('❌ Failed to start bot:', err);
});
