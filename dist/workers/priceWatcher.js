"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPricesOnce = checkPricesOnce;
exports.msUntilNextRefresh = msUntilNextRefresh;
exports.startPriceWatcher = startPriceWatcher;
exports.stopPriceWatcher = stopPriceWatcher;
const index_1 = require("../db/src/index");
const binance_1 = require("../services/binance");
const fcm_1 = require("../services/fcm");
const constants_1 = require("../config/constants");
const db_1 = require("../services/db");
let running = false;
let timeoutId = null;
// Track the close timestamp of the last processed candle per asset to check freshness
const lastSeenCandleTimes = new Map();
async function checkPricesOnce() {
    try {
        const isTest = process.env.NODE_ENV === 'test';
        const openSignals = await index_1.prisma.signal.findMany({
            where: {
                status: 'ENTRY_OPEN',
                ...(isTest ? {} : { adminId: { in: constants_1.ADMIN_NUMBERS } }),
            },
        });
        if (openSignals.length === 0) {
            return;
        }
        console.log(`👁️ Price Watcher: Checking prices for ${openSignals.length} open signal(s)...`);
        // Group open signals by asset/coingeckoId to optimize API fetch calls
        const signalsByGroup = new Map();
        for (const signal of openSignals) {
            const groupKey = signal.coingeckoId || signal.asset;
            const list = signalsByGroup.get(groupKey) || [];
            list.push(signal);
            signalsByGroup.set(groupKey, list);
        }
        for (const [groupKey, signals] of signalsByGroup.entries()) {
            const asset = signals[0].asset;
            const coingeckoId = signals[0].coingeckoId;
            let candles = await (0, binance_1.getLiveOHLC)(asset, coingeckoId);
            if (!candles || candles.length === 0) {
                console.warn(`⚠️ Price Watcher: Could not fetch OHLC data for ${asset} (group: ${groupKey})`);
                continue;
            }
            let latestCandle = candles[candles.length - 1];
            let [timestamp, open, high, low, close] = latestCandle;
            const prevTimestamp = lastSeenCandleTimes.get(groupKey);
            // In test mode, always assume fresh to allow immediate evaluation of sequential mock prices
            let isFresh = isTest || prevTimestamp === undefined || timestamp > prevTimestamp;
            // Stale check & retry loop in production/non-test environment
            if (!isFresh && !isTest) {
                const maxRetries = 5;
                const retryDelayMs = 10000; // 10 seconds
                let attempt = 0;
                while (!isFresh && attempt < maxRetries) {
                    attempt++;
                    console.log(`⏳ Price Watcher: ${asset} (${groupKey}) data is stale (timestamp: ${timestamp}). Retrying in ${retryDelayMs / 1000}s (Attempt ${attempt}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                    candles = await (0, binance_1.getLiveOHLC)(asset, coingeckoId);
                    if (candles && candles.length > 0) {
                        latestCandle = candles[candles.length - 1];
                        [timestamp, open, high, low, close] = latestCandle;
                        isFresh = timestamp > (prevTimestamp || 0);
                    }
                }
                if (!isFresh) {
                    console.warn(`⚠️ Price Watcher: CoinGecko cache for ${asset} (${groupKey}) did not turn over after ${maxRetries} retries. Skipping this cycle.`);
                    continue;
                }
            }
            if (isFresh && !isTest) {
                lastSeenCandleTimes.set(groupKey, timestamp);
            }
            console.log(`📈 Price Watcher: ${asset} (${groupKey}) OHLC Candle Close Time = ${new Date(timestamp).toLocaleTimeString()} ` +
                `| High = ${high} | Low = ${low} | Fresh = ${isFresh || isTest}`);
            for (const signal of signals) {
                // Flag data as stale if the candle close time is less than 30 minutes younger than when the signal was dropped
                const minCandleCloseTime = signal.createdAt.getTime() + 30 * 60 * 1000;
                if (timestamp < minCandleCloseTime) {
                    console.warn(`⚠️ Price Watcher: Candle close time (${new Date(timestamp).toISOString()}) for ${asset} ` +
                        `is less than 30-min ahead of signal drop time (${signal.createdAt.toISOString()}). Data is stale for signal ${signal.id}. Skipping.`);
                    continue;
                }
                console.log(`🔍 Price Watcher: Evaluating signal ${signal.id} for ${asset} | TP = ${signal.tpPrice} | SL = ${signal.slPrice}`);
                let hitTp = false;
                let hitSl = false;
                let hitPrice = close;
                if (signal.direction === 'BUY') {
                    if (high >= signal.tpPrice) {
                        hitTp = true;
                        hitPrice = signal.tpPrice;
                    }
                    else if (low <= signal.slPrice) {
                        hitSl = true;
                        hitPrice = signal.slPrice;
                    }
                }
                else if (signal.direction === 'SELL') {
                    if (low <= signal.tpPrice) {
                        hitTp = true;
                        hitPrice = signal.tpPrice;
                    }
                    else if (high >= signal.slPrice) {
                        hitSl = true;
                        hitPrice = signal.slPrice;
                    }
                }
                if (hitTp) {
                    console.log(`🎯 Price Watcher: TP hit for signal ${signal.id} (${signal.asset} at target price of ${hitPrice})`);
                    await (0, db_1.updateStatus)(signal.id, 'TP_HIT');
                    await (0, fcm_1.sendPushNotification)({
                        signalId: signal.id,
                        urgencyScore: 10,
                        message: `🎯 ${signal.asset} Take Profit Hit! Target of +${signal.tpPercent}% reached.`,
                    });
                }
                else if (hitSl) {
                    console.log(`🔴 Price Watcher: SL hit for signal ${signal.id} (${signal.asset} at stop price of ${hitPrice})`);
                    await (0, db_1.updateStatus)(signal.id, 'SL_HIT');
                    await (0, fcm_1.sendPushNotification)({
                        signalId: signal.id,
                        urgencyScore: 10,
                        message: `🔴 ${signal.asset} Stop Loss Hit. Signal closed at -${signal.slPercent}%.`,
                    });
                }
            }
        }
    }
    catch (error) {
        console.error('❌ Price Watcher: Error in checkPrices cycle:', error.message);
    }
}
/**
 * Calculates the milliseconds remaining until the next clock-aligned 15-minute boundary.
 * Adds a 3-second buffer to ensure CoinGecko's cache has refreshed.
 */
function msUntilNextRefresh() {
    const now = Date.now();
    const intervalMs = 15 * 60 * 1000;
    const msIntoCurrentInterval = now % intervalMs;
    return (intervalMs - msIntoCurrentInterval) + 3000;
}
function startPriceWatcher(intervalMs) {
    if (running)
        return;
    running = true;
    if (intervalMs) {
        console.log(`👁️ Price watcher loop started. Interval: ${intervalMs / 1000}s`);
    }
    else {
        console.log(`👁️ Price watcher loop started on 15-minute clock-aligned boundaries.`);
    }
    async function loop() {
        if (!running)
            return;
        await checkPricesOnce();
        const wait = intervalMs ?? msUntilNextRefresh();
        if (!intervalMs) {
            console.log(`👁️ Price Watcher: Sleeping for ${Math.round(wait / 1000)}s until next refresh boundary.`);
        }
        timeoutId = setTimeout(loop, wait);
    }
    loop();
}
function stopPriceWatcher() {
    running = false;
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    console.log(`👁️ Price watcher loop stopped.`);
}
