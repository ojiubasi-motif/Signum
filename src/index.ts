import { startBot } from './bot';
import { signalWorker } from './workers/signalWorker';
import { startPriceWatcher } from './workers/priceWatcher';
import { startApiServer } from './api/server';

console.log('🚀 Starting Signum Bot...');
console.log('⚙️ Starting BullMQ Signal Worker...');
console.log('⚙️ Starting Price Watcher...');
console.log('⚙️ Starting REST API Server...');

// Reference worker to ensure it initializes and runs
const worker = signalWorker;

// Start price watcher loop on 15-minute clock-aligned boundaries
startPriceWatcher();

// Start REST API server
startApiServer();

startBot().catch(err => {
  console.error('❌ Failed to start bot:', err);
});
