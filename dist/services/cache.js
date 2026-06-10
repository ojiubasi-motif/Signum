"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheResolvedSignal = cacheResolvedSignal;
exports.getCachedSignal = getCachedSignal;
exports.getCachedResolvedSignals = getCachedResolvedSignals;
exports.evictCachedSignal = evictCachedSignal;
const redis_1 = require("../config/redis");
/**
 * Caches a resolved signal (TP_HIT, SL_HIT, EXPIRED) in Redis.
 * Sets a key-value pair with a 24-hour expiration time and updates a sorted set of resolved signal IDs.
 * @param signal The signal object to cache
 */
async function cacheResolvedSignal(signal) {
    if (!signal || !signal.id)
        return false;
    const signalId = signal.id;
    const key = `signal:resolved:${signalId}`;
    const serialized = JSON.stringify(signal);
    try {
        // 1. Save signal payload with 24-hour expiration (86400 seconds)
        await redis_1.redisConnection.setex(key, 86400, serialized);
        // 2. Add signal ID to sorted set (scored by current time to order by most recently resolved)
        await redis_1.redisConnection.zadd('signals:resolved', Date.now(), signalId);
        // 3. Keep the sorted set clean: limit to last 100 resolved signals to prevent bloat
        const totalCount = await redis_1.redisConnection.zcard('signals:resolved');
        if (totalCount > 100) {
            // Remove oldest entries past rank 100
            await redis_1.redisConnection.zremrangebyrank('signals:resolved', 0, totalCount - 101);
        }
        console.log(`💾 cache: Successfully cached resolved signal ${signalId} (${signal.asset}) in Redis.`);
        return true;
    }
    catch (error) {
        console.error(`❌ cache: Failed to cache resolved signal ${signalId}:`, error.message);
        return false;
    }
}
/**
 * Retrieves a single cached resolved signal payload from Redis.
 * @param signalId The unique signal ID to lookup
 */
async function getCachedSignal(signalId) {
    const key = `signal:resolved:${signalId}`;
    try {
        const raw = await redis_1.redisConnection.get(key);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch (error) {
        console.error(`❌ cache: Error reading cached signal ${signalId}:`, error.message);
        return null;
    }
}
/**
 * Retrieves all cached resolved signals from Redis, sorted by most recently resolved first.
 */
async function getCachedResolvedSignals() {
    try {
        // Retrieve list of signal IDs sorted desc (newest first)
        const ids = await redis_1.redisConnection.zrevrange('signals:resolved', 0, -1);
        if (ids.length === 0)
            return [];
        const keys = ids.map(id => `signal:resolved:${id}`);
        const rawSignals = await redis_1.redisConnection.mget(...keys);
        const signals = [];
        for (let i = 0; i < rawSignals.length; i++) {
            const raw = rawSignals[i];
            if (raw) {
                try {
                    signals.push(JSON.parse(raw));
                }
                catch (e) {
                    // Ignore parse errors
                }
            }
        }
        return signals;
    }
    catch (error) {
        console.error('❌ cache: Error reading cached resolved signals list:', error.message);
        return [];
    }
}
/**
 * Evicts a resolved signal from the Redis cache.
 * @param signalId The unique signal ID to evict
 */
async function evictCachedSignal(signalId) {
    const key = `signal:resolved:${signalId}`;
    try {
        await redis_1.redisConnection.del(key);
        await redis_1.redisConnection.zrem('signals:resolved', signalId);
        console.log(`💾 cache: Evicted signal ${signalId} from Redis cache.`);
        return true;
    }
    catch (error) {
        console.error(`❌ cache: Failed to evict signal ${signalId}:`, error.message);
        return false;
    }
}
