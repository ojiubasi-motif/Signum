import { Redis } from 'ioredis';

// Export connection configuration for BullMQ
export const redisConnection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null, // Mandatory configuration for BullMQ integration
});
