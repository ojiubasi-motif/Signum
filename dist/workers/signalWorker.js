"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalWorker = void 0;
const bullmq_1 = require("bullmq");
const agent_1 = require("../agent");
const db_1 = require("../services/db");
const redis_1 = require("../config/redis");
exports.signalWorker = new bullmq_1.Worker('signals', async (job) => {
    const { type, text, adminId, messageId } = job.data;
    if (type !== 'PROCESS_NEW_MESSAGE') {
        console.log(`⚙️ Worker skipping job type: ${type}`);
        return;
    }
    console.log(`⚙️ Worker processing signal job [${job.id}] for admin [${adminId}]`);
    try {
        // Build context for the agent from database
        const context = await (0, db_1.getAdminContext)(adminId);
        console.log(`⚙️ Starting agent run for ${context.adminName}...`);
        await (0, agent_1.runSignalAgent)(text, adminId, context, messageId);
        console.log(`✅ Job [${job.id}] processed successfully`);
    }
    catch (error) {
        console.error(`❌ Worker failed to process job [${job.id}]:`, error.message);
        throw error; // Re-throw to trigger retry options
    }
}, {
    connection: redis_1.redisConnection, // Cast to any to bypass ioredis/bullmq typescript compatibility quirks
    concurrency: 2, // Process up to 2 jobs concurrently
});
exports.signalWorker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
});
exports.signalWorker.on('completed', (job) => {
    console.log(`✨ Worker finished job ${job?.id}`);
});
