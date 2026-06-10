"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisConnection = void 0;
const ioredis_1 = require("ioredis");
// Export connection configuration for BullMQ
exports.redisConnection = new ioredis_1.Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null, // Mandatory configuration for BullMQ integration
});
