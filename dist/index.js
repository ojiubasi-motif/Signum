"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bot_1 = require("./bot");
const signalWorker_1 = require("./workers/signalWorker");
const priceWatcher_1 = require("./workers/priceWatcher");
const server_1 = require("./api/server");
console.log('🚀 Starting Signum Bot...');
console.log('⚙️ Starting BullMQ Signal Worker...');
console.log('⚙️ Starting Price Watcher...');
console.log('⚙️ Starting REST API Server...');
// Reference worker to ensure it initializes and runs
const worker = signalWorker_1.signalWorker;
// Start price watcher loop on 15-minute clock-aligned boundaries
(0, priceWatcher_1.startPriceWatcher)();
// Start REST API server
(0, server_1.startApiServer)();
(0, bot_1.startBot)().catch(err => {
    console.error('❌ Failed to start bot:', err);
});
