import { prisma } from '../db/src/index';
import { getLivePrice } from './binance';
import { getCachedResolvedSignals } from './cache';
import { formatPrice, formatWhatsappNumber } from '../utils/formatter';

// ─── Input validation helpers ────────────────────────────────────────────────

/** SSRF-safe symbol regex — same allow-list as binance.ts */
const SYMBOL_RE = /^[A-Z0-9]{1,10}$/;

/** Max numeric value accepted in calc / pnl to prevent overflow */
const MAX_NUMERIC = 1e12;

// ─── Menu ────────────────────────────────────────────────────────────────────

export function getMenu(): string {
  return (
    `📱 *Welcome to Signum Bot!* 🤖\n\n` +
    `Here's what I can help you with:\n\n` +
    `📋 *COMMANDS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔍 *price <SYMBOL>* — Live market price\n` +
    `   _e.g._ price BTC, price ETH\n\n` +
    `📐 *calc <entry> <tp%> <sl%>* — TP/SL Calculator\n` +
    `   _e.g._ calc 60000 2 1\n\n` +
    `💰 *pnl <capital> <±%>* — PNL Evaluator\n` +
    `   _e.g._ pnl 1000 5.5  or  pnl 500 -2.3\n\n` +
    `🟢 *active* — All active signals (not yet resolved)\n` +
    `📍 *open* — Open signals (price still in/below entry zone)\n` +
    `📜 *history* — Recently resolved signals\n` +
    `📊 *stats* — Admin win-rate leaderboard\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💬 Or just ask me anything crypto-related!`
  );
}

// ─── Price ───────────────────────────────────────────────────────────────────

export async function getPriceCommand(rawSymbol: string): Promise<string> {
  const symbol = rawSymbol.trim().toUpperCase().slice(0, 10);
  if (!SYMBOL_RE.test(symbol)) {
    return `❌ *Invalid symbol*: "${rawSymbol}". Symbols must be 1-10 alphanumeric characters (e.g. BTC, ETH).`;
  }

  try {
    const price = await getLivePrice(symbol);
    if (price === null || price === undefined) {
      return `⚠️ Could not find a live price for *${symbol}*. Check the symbol and try again.`;
    }
    return `💲 *${symbol}* current price: *$${formatPrice(price)}*`;
  } catch (err: any) {
    console.error(`[botCommands] getPriceCommand error for ${symbol}:`, err.message);
    return `⚠️ Failed to fetch price for *${symbol}* right now. Please try again shortly.`;
  }
}

// ─── TP/SL Calculator ────────────────────────────────────────────────────────

export function getCalcCommand(rawEntry: string, rawTpPct: string, rawSlPct: string): string {
  const entry = parseFloat(rawEntry);
  const tpPct = parseFloat(rawTpPct);
  const slPct = parseFloat(rawSlPct);

  if (!isFinite(entry) || !isFinite(tpPct) || !isFinite(slPct)) {
    return `❌ *Invalid input*. All values must be numbers.\n_Usage_: calc <entry> <tp%> <sl%>\n_e.g._ calc 60000 2 1`;
  }
  if (entry <= 0 || entry > MAX_NUMERIC) {
    return `❌ *Entry price* must be a positive number (max 1 trillion).`;
  }
  if (tpPct <= 0 || tpPct > 10000) {
    return `❌ *TP%* must be between 0 and 10000.`;
  }
  if (slPct <= 0 || slPct > 10000) {
    return `❌ *SL%* must be between 0 and 10000.`;
  }

  const tpPrice = entry * (1 + tpPct / 100);
  const slPrice = entry * (1 - slPct / 100);
  const rrRatio = tpPct / slPct;

  return (
    `📐 *TP/SL Calculator*\n\n` +
    `├─ Entry Price:   $${formatPrice(entry)}\n` +
    `├─ Take Profit:   $${formatPrice(tpPrice)} (+${tpPct}%)\n` +
    `├─ Stop Loss:     $${formatPrice(slPrice)} (-${slPct}%)\n` +
    `└─ Risk/Reward:   1:${rrRatio.toFixed(2)}`
  );
}

// ─── PNL Evaluator ───────────────────────────────────────────────────────────

export function getPnlCommand(rawCapital: string, rawPctStr: string): string {
  const capital = parseFloat(rawCapital);
  const pct = parseFloat(rawPctStr);

  if (!isFinite(capital) || !isFinite(pct)) {
    return `❌ *Invalid input*. Both values must be numbers.\n_Usage_: pnl <capital> <±%>\n_e.g._ pnl 1000 5.5  or  pnl 500 -2.3`;
  }
  if (capital <= 0 || capital > MAX_NUMERIC) {
    return `❌ *Capital* must be a positive number (max 1 trillion).`;
  }
  if (Math.abs(pct) > 10000) {
    return `❌ *Percentage* must be between -10000 and +10000.`;
  }

  const change = capital * (pct / 100);
  const finalBalance = capital + change;
  const emoji = pct >= 0 ? '📈' : '📉';
  const label = pct >= 0 ? 'Profit' : 'Loss';

  return (
    `${emoji} *PNL Evaluator*\n\n` +
    `├─ Capital:       $${formatPrice(capital)}\n` +
    `├─ Change:        ${pct >= 0 ? '+' : ''}${pct}%\n` +
    `├─ ${label}:         $${formatPrice(Math.abs(change))}\n` +
    `└─ Final Balance: $${formatPrice(finalBalance)}`
  );
}

// ─── Active Signals ──────────────────────────────────────────────────────────

export async function getActiveSignals(): Promise<string> {
  const signals = await prisma.signal.findMany({
    where: { status: 'ENTRY_OPEN' },
    include: { admin: true },
    orderBy: { createdAt: 'desc' },
  });

  if (signals.length === 0) {
    return '📭 *Signum*: No active trading signals at the moment.';
  }

  let reply = `🟢 *Active Signals (${signals.length})* 🟢\n\n`;
  reply += signals
    .map(
      s =>
        `*${s.asset}* (${s.direction})\n` +
        `├─ Entry Zone: $${formatPrice(s.entryMin)} – $${formatPrice(s.entryMax)}\n` +
        `├─ Take Profit: $${formatPrice(s.tpPrice)} (+${s.tpPercent}%)\n` +
        `├─ Stop Loss: $${formatPrice(s.slPrice)} (-${s.slPercent}%)\n` +
        `├─ Risk/Reward: 1:${s.rrRatio.toFixed(2)}\n` +
        `└─ Posted By: *${s.admin.name !== s.admin.id.split('@')[0] ? s.admin.name : formatWhatsappNumber(s.admin.id)}*`,
    )
    .join('\n\n');

  return reply;
}

// ─── Open Signals ────────────────────────────────────────────────────────────

export async function getOpenSignals(): Promise<string> {
  const signals = await prisma.signal.findMany({
    where: { status: 'ENTRY_OPEN' },
    include: { admin: true },
    orderBy: { createdAt: 'desc' },
  });

  if (signals.length === 0) {
    return '📭 *Signum*: No active trading signals at the moment.';
  }

  const openSignals: Array<{ signal: typeof signals[0]; price: number }> = [];

  for (const signal of signals) {
    try {
      const price = await getLivePrice(signal.asset, signal.coingeckoId);
      if (price !== null && price !== undefined && price <= signal.entryMax) {
        openSignals.push({ signal, price });
      }
    } catch {
      // Fail safe: skip this signal if price fetch fails
    }
  }

  if (openSignals.length === 0) {
    return (
      `📍 *Open Signals*: None of the ${signals.length} active signal(s) are currently ` +
      `within their entry zone. Price may have moved above entry.\n\n` +
      `Type *active* to see all active signals regardless of price position.`
    );
  }

  let reply = `📍 *Open Signals (${openSignals.length})* — Price in/below entry zone\n\n`;
  reply += openSignals
    .map(
      ({ signal: s, price }) =>
        `*${s.asset}* (${s.direction})\n` +
        `├─ Current Price: $${formatPrice(price)}\n` +
        `├─ Entry Zone: $${formatPrice(s.entryMin)} – $${formatPrice(s.entryMax)}\n` +
        `├─ Take Profit: $${formatPrice(s.tpPrice)} (+${s.tpPercent}%)\n` +
        `├─ Stop Loss: $${formatPrice(s.slPrice)} (-${s.slPercent}%)\n` +
        `└─ Risk/Reward: 1:${s.rrRatio.toFixed(2)}`,
    )
    .join('\n\n');

  return reply;
}

// ─── Signal History ──────────────────────────────────────────────────────────

export async function getSignalHistory(): Promise<string> {
  const cachedSignals = await getCachedResolvedSignals();
  if (cachedSignals.length === 0) {
    return '📭 *Signum Cache*: No recently resolved signals found.';
  }

  let reply = `🎯 *Recently Resolved Signals (${cachedSignals.length})* 🎯\n\n`;
  reply += cachedSignals
    .map(
      s =>
        `*${s.asset}* (${s.direction})\n` +
        `├─ Status: *${s.status}*\n` +
        `├─ Entry Zone: $${formatPrice(s.entryMin)} – $${formatPrice(s.entryMax)}\n` +
        `├─ Target TP: $${formatPrice(s.tpPrice)} (+${s.tpPercent}%)\n` +
        `├─ Stop Loss: $${formatPrice(s.slPrice)} (-${s.slPercent}%)\n` +
        `└─ Resolved: ${new Date(s.resolvedAt).toLocaleString()}`,
    )
    .join('\n\n');

  return reply;
}
