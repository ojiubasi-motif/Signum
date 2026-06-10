"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
// Queue definition — one queue, two job types
exports.signalQueue = new bullmq_1.Queue('signals', {
    connection: redis_1.redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
});
