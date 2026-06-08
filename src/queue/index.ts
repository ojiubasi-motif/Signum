import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

// Queue definition — one queue, two job types
export const signalQueue = new Queue('signals', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

// Job type definitions
export type SignalJob =
  | { type: 'PROCESS_NEW_MESSAGE'; text: string; adminId: string; messageId: string; timestamp: number }
  | { type: 'CHECK_SIGNAL_STATUS'; signalId: string };
