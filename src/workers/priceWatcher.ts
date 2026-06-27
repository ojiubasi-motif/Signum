import { prisma } from '../db/src/index';
import { getLiveOHLC } from '../services/binance';
import { sendPushNotification } from '../services/fcm';
import { sendWhatsappMessage } from '../services/whatsapp';
import { formatPrice } from '../utils/formatter';
import { ADMIN_NUMBERS } from '../config/constants';
import { updateStatus } from '../services/db';

let running = false;
let timeoutId: NodeJS.Timeout | null = null;

// Track the close timestamp of the last processed candle per asset to check freshness
const lastSeenCandleTimes = new Map<string, number>();

export async function checkPricesOnce() {
  try {
    const isTest = process.env.NODE_ENV === 'test';
    const openSignals = await prisma.signal.findMany({
      where: {
        status: 'ENTRY_OPEN',
        ...(isTest ? {} : { adminId: { in: ADMIN_NUMBERS } }),
      },
    });

    if (openSignals.length === 0) {
      return;
    }

    console.log(`👁️ Price Watcher: Checking prices for ${openSignals.length} open signal(s)...`);

    // Group open signals by asset/coingeckoId to optimize API fetch calls
    const signalsByGroup = new Map<string, typeof openSignals>();
    for (const signal of openSignals) {
      const groupKey = signal.coingeckoId || signal.asset;
      const list = signalsByGroup.get(groupKey) || [];
      list.push(signal);
      signalsByGroup.set(groupKey, list);
    }

    for (const [groupKey, signals] of signalsByGroup.entries()) {
      const asset = signals[0].asset;
      const coingeckoId = signals[0].coingeckoId;

      let candles = await getLiveOHLC(asset, coingeckoId, signals[0].poolNetwork, signals[0].poolAddress);
      if (!candles || candles.length === 0) {
        console.warn(`⚠️ Price Watcher: Could not fetch OHLC data for ${asset} (group: ${groupKey})`);
        continue;
      }

      // Infer candle interval from consecutive timestamps (robust for 15-min and 30-min series)
      const candleIntervalMs = candles.length >= 2
        ? candles[1][0] - candles[0][0]
        : 15 * 60 * 1000;

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
          console.log(`⏳ Price Watcher: ${asset} (${groupKey}) CoinGecko cache not yet rolled over (last candle: ${new Date(timestamp).toISOString()}). Retrying in ${retryDelayMs / 1000}s (Attempt ${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          
          candles = await getLiveOHLC(asset, coingeckoId, signals[0].poolNetwork, signals[0].poolAddress);
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

      console.log(
        `📈 Price Watcher: ${asset} (${groupKey}) OHLC Candle Close Time = ${new Date(timestamp).toLocaleTimeString()} ` +
        `| High = ${formatPrice(high)} | Low = ${formatPrice(low)} | Fresh = ${isFresh || isTest}`
      );

      for (const signal of signals) {
        // A candle is only valid for a signal if its OPEN time is >= the signal drop time.
        // Both CoinGecko and GeckoTerminal return CLOSE timestamps, so:
        //   candleOpenTime = timestamp - candleIntervalMs
        //
        // Example: signal dropped at 8:29, candle closes at 8:30 (opens at 8:15).
        //   candleOpenTime (8:15) < signalDropTime (8:29) → INVALID, skip.
        //   The 8:45 candle (opens at 8:30) would be the first valid one.
        const candleOpenTime = timestamp - candleIntervalMs;
        const signalDropTime = signal.createdAt.getTime();

        if (candleOpenTime < signalDropTime) {
          console.warn(
            `⚠️ Price Watcher: Candle [${new Date(candleOpenTime).toISOString()} → ${new Date(timestamp).toISOString()}] for ${asset} ` +
            `opened before signal drop (${signal.createdAt.toISOString()}). ` +
            `Waiting for next candle for signal ${signal.id}.`
          );

          // Only alert admin if this is a DEX-pool-only asset (no coingeckoId)
          // with no usable data — indicates the pool may be inactive.
          if (!signal.coingeckoId && !signal.marketUnavailable) {
            await prisma.signal.update({
              where: { id: signal.id },
              data: { marketUnavailable: true },
            }).catch(err => {
              console.error(`❌ Price Watcher: Failed to update marketUnavailable for signal ${signal.id}:`, err.message);
            });
            signal.marketUnavailable = true;

            const alertMsg = `⚠️ *Market Data Inactive*\n\nNo recent trades found for *${asset.toUpperCase()}* on GeckoTerminal (last data: ${new Date(timestamp).toISOString()}).\nMonitor the market manually for signal tracking.`;
            await sendWhatsappMessage(signal.adminId, alertMsg).catch(err => {
              console.error(`❌ Price Watcher: Failed to send inactive alert for ${asset}:`, err.message);
            });
          }
          continue;
        }

        console.log(
          `🔍 Price Watcher: Evaluating signal ${signal.id} for ${asset} | TP = ${formatPrice(signal.tpPrice)} | SL = ${formatPrice(signal.slPrice)}`
        );

        let hitTp = false;
        let hitSl = false;
        let hitPrice = close;

        if (signal.direction === 'BUY') {
          if (high >= signal.tpPrice) {
            hitTp = true;
            hitPrice = signal.tpPrice;
          } else if (low <= signal.slPrice) {
            hitSl = true;
            hitPrice = signal.slPrice;
          }
        } else if (signal.direction === 'SELL') {
          if (low <= signal.tpPrice) {
            hitTp = true;
            hitPrice = signal.tpPrice;
          } else if (high >= signal.slPrice) {
            hitSl = true;
            hitPrice = signal.slPrice;
          }
        }

        if (hitTp) {
          console.log(`🎯 Price Watcher: TP hit for signal ${signal.id} (${signal.asset} at target price of ${formatPrice(hitPrice)})`);
          await updateStatus(signal.id, 'TP_HIT');

          await sendPushNotification({
            signalId: signal.id,
            urgencyScore: 10,
            message: `🎯 ${signal.asset} Take Profit Hit! Target of +${signal.tpPercent}% reached.`,
          });
        } else if (hitSl) {
          console.log(`🔴 Price Watcher: SL hit for signal ${signal.id} (${signal.asset} at stop price of ${formatPrice(hitPrice)})`);
          await updateStatus(signal.id, 'SL_HIT');

          await sendPushNotification({
            signalId: signal.id,
            urgencyScore: 10,
            message: `🔴 ${signal.asset} Stop Loss Hit. Signal closed at -${signal.slPercent}%.`,
          });
        }
      }
    }
  } catch (error: any) {
    console.error('❌ Price Watcher: Error in checkPrices cycle:', error.message);
  }
}

/**
 * Calculates the milliseconds remaining until the next clock-aligned 15-minute boundary.
 * Adds a 3-second buffer to ensure CoinGecko's cache has refreshed.
 */
export function msUntilNextRefresh(): number {
  const now = Date.now();
  const intervalMs = 15 * 60 * 1000;
  const msIntoCurrentInterval = now % intervalMs;
  return (intervalMs - msIntoCurrentInterval) + 3000;
}

export function startPriceWatcher(intervalMs?: number) {
  if (running) return;
  running = true;
  if (intervalMs) {
    console.log(`👁️ Price watcher loop started. Interval: ${intervalMs / 1000}s`);
  } else {
    console.log(`👁️ Price watcher loop started on 15-minute clock-aligned boundaries.`);
  }

  async function loop() {
    if (!running) return;
    await checkPricesOnce();
    
    const wait = intervalMs ?? msUntilNextRefresh();
    if (!intervalMs) {
      console.log(`👁️ Price Watcher: Sleeping for ${Math.round(wait / 1000)}s until next refresh boundary.`);
    }
    timeoutId = setTimeout(loop, wait);
  }

  loop();
}

export function stopPriceWatcher() {
  running = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  console.log(`👁️ Price watcher loop stopped.`);
}
