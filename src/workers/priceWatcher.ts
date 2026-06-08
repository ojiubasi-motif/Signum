import { prisma } from '../db/src/index';
import { getLivePrice } from '../services/binance';
import { sendPushNotification } from '../services/fcm';
import { ADMIN_NUMBERS } from '../config/constants';
import { updateStatus } from '../services/db';

let running = false;
let timeoutId: NodeJS.Timeout | null = null;

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

    for (const signal of openSignals) {
      const price = await getLivePrice(signal.asset);
      if (price === null) {
        console.warn(`⚠️ Price Watcher: Could not fetch price for ${signal.asset}`);
        continue;
      }

      console.log(`📈 Price Watcher: ${signal.asset} Live Price = ${price} | TP = ${signal.tpPrice} | SL = ${signal.slPrice}`);

      let hitTp = false;
      let hitSl = false;

      if (signal.direction === 'BUY') {
        if (price >= signal.tpPrice) hitTp = true;
        else if (price <= signal.slPrice) hitSl = true;
      } else if (signal.direction === 'SELL') {
        if (price <= signal.tpPrice) hitTp = true;
        else if (price >= signal.slPrice) hitSl = true;
      }

      if (hitTp) {
        console.log(`🎯 Price Watcher: TP hit for signal ${signal.id} (${signal.asset} at ${price})`);
        await updateStatus(signal.id, 'TP_HIT');

        await sendPushNotification({
          signalId: signal.id,
          urgencyScore: 10,
          message: `🎯 ${signal.asset} Take Profit Hit! Target of +${signal.tpPercent}% reached.`,
        });
      } else if (hitSl) {
        console.log(`🔴 Price Watcher: SL hit for signal ${signal.id} (${signal.asset} at ${price})`);
        await updateStatus(signal.id, 'SL_HIT');

        await sendPushNotification({
          signalId: signal.id,
          urgencyScore: 10,
          message: `🔴 ${signal.asset} Stop Loss Hit. Signal closed at -${signal.slPercent}%.`,
        });
      }
    }
  } catch (error: any) {
    console.error('❌ Price Watcher: Error in checkPrices cycle:', error.message);
  }
}

export function startPriceWatcher(intervalMs = 30000) {
  if (running) return;
  running = true;
  console.log(`👁️ Price watcher loop started. Interval: ${intervalMs / 1000}s`);

  async function loop() {
    if (!running) return;
    await checkPricesOnce();
    timeoutId = setTimeout(loop, intervalMs);
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
