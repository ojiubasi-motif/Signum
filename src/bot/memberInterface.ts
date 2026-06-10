import { prisma } from '../db/src/index';
import { getLivePrice, setMockPrice } from '../services/binance';
import { getCachedResolvedSignals } from '../services/cache';
import { formatWhatsappNumber } from '../utils/formatter';
import Groq from 'groq-sdk';

let groqInstance: Groq | null = null;
function getGroq(): Groq {
  if (!groqInstance) {
    groqInstance = new Groq({
      apiKey: process.env.GROQ_API_KEY || '',
    });
  }
  return groqInstance;
}

/**
 * Handles incoming direct messages (DMs) from members.
 * Parses keywords or routes requests to Groq for conversational interactions.
 * @param from The sender's WhatsApp number / JID
 * @param text The message text content
 */
export async function processMemberMessage(from: string, text: string): Promise<string> {
  const normalizedText = text.trim().toLowerCase();

  // 1. ACTIVE / OPEN SIGNALS QUERY
  if (normalizedText === 'active' || normalizedText === 'open') {
    const signals = await prisma.signal.findMany({
      where: {
        status: 'ENTRY_OPEN',
      },
      include: {
        admin: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (signals.length === 0) {
      return '📭 *Signum Alert*: There are no active trading signals open at the moment.';
    }

    let reply = '🟢 *Active Signum Trading Signals* 🟢\n\n';
    reply += signals
      .map(
        s =>
          `*${s.asset}* (${s.direction})\n` +
          `├─ Entry Zone: $${s.entryMin} – $${s.entryMax}\n` +
          `├─ Take Profit: $${s.tpPrice} (+${s.tpPercent}%)\n` +
          `├─ Stop Loss: $${s.slPrice} (-${s.slPercent}%)\n` +
          `├─ Risk/Reward Ratio: 1:${s.rrRatio.toFixed(2)}\n` +
          `└─ Posted By: Admin *${s.admin.name === s.admin.id.split('@')[0] ? formatWhatsappNumber(s.admin.id) : s.admin.name}*`
      )
      .join('\n\n');

    return reply;
  }

  // 1.5 EXPIRED / CLOSED SIGNALS QUERY (cached in Redis)
  if (normalizedText === 'expired' || normalizedText === 'history' || normalizedText === 'closed') {
    const cachedSignals = await getCachedResolvedSignals();
    if (cachedSignals.length === 0) {
      return '📭 *Signum Cache*: No recently resolved signals found in the cache.';
    }

    let reply = '🎯 *Recently Resolved Trading Signals (Cached)* 🎯\n\n';
    reply += cachedSignals
      .map(
        s =>
          `*${s.asset}* (${s.direction})\n` +
          `├─ Status: *${s.status}*\n` +
          `├─ Entry Zone: $${s.entryMin} – $${s.entryMax}\n` +
          `├─ Target TP Price: $${s.tpPrice} (+${s.tpPercent}%)\n` +
          `├─ Triggered SL Price: $${s.slPrice} (-${s.slPercent}%)\n` +
          `└─ Resolved At: ${new Date(s.resolvedAt).toLocaleString()}`
      )
      .join('\n\n');

    return reply;
  }

  // 2. ADMIN STATS / LEADERBOARD
  if (normalizedText === 'stats' || normalizedText === 'win rate' || normalizedText === 'leaderboard') {
    const admins = await prisma.admin.findMany({
      orderBy: {
        winRate: 'desc',
      },
    });

    if (admins.length === 0) {
      return '📊 *Signum Stats*: No admins are registered or active yet.';
    }

    let reply = '📊 *Signum Admin Leaderboard* 📊\n\n';
    reply += admins
      .map(
        a =>
          `👤 *Admin ${a.name === a.id.split('@')[0] ? formatWhatsappNumber(a.id) : a.name}*\n` +
          `├─ Win Rate: ${a.winRate.toFixed(1)}%\n` +
          `├─ Total Signals: ${a.totalSignals}\n` +
          `└─ Wins/Losses: ${a.totalWins} / ${a.totalSignals - a.totalWins}`
      )
      .join('\n\n');

    return reply;
  }

  // 2.5 MOCK PRICE COMMAND
  const mockMatch = normalizedText.match(/^mock\s+([a-zA-Z0-9]+)\s+([0-9.]+)/i);
  if (mockMatch) {
    const assetName = mockMatch[1].toUpperCase();
    const priceValue = parseFloat(mockMatch[2]);
    if (isNaN(priceValue)) {
      return `❌ *Signum Alert*: Invalid price value.`;
    }
    setMockPrice(assetName, priceValue);
    return `✅ *Mock Price Set*: Live price for *${assetName}* is now stubbed at **$${priceValue}**.`;
  }

  // 3. LOG MEMBER TRADE
  const tradeMatch = normalizedText.match(/(?:took|taking|take)\s+([a-zA-Z0-9]+)/i);
  if (tradeMatch) {
    const assetName = tradeMatch[1].toUpperCase();

    // Find the latest active signal for this asset
    const signal = await prisma.signal.findFirst({
      where: {
        asset: assetName,
        status: 'ENTRY_OPEN',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!signal) {
      return `❌ *Signum Alert*: No active signal found for asset *${assetName}*. Text *active* to view currently open entry zones.`;
    }

    // Ensure member exists
    let member = await prisma.member.findUnique({
      where: { whatsappNumber: from },
    });

    if (!member) {
      member = await prisma.member.create({
        data: {
          whatsappNumber: from,
        },
      });
    }

    // Check if member already logged this trade
    const existingTrade = await prisma.memberTrade.findFirst({
      where: {
        memberId: member.id,
        signalId: signal.id,
      },
    });

    if (existingTrade) {
      return `ℹ️ *Signum Info*: You have already logged a trade for this *${assetName}* signal.`;
    }

    // Register MemberTrade
    await prisma.memberTrade.create({
      data: {
        memberId: member.id,
        signalId: signal.id,
      },
    });

    return (
      `✅ *Trade Registered!* 🚀\n\n` +
      `You are now tracking the latest *${assetName}* signal:\n` +
      `├─ Direction: ${signal.direction}\n` +
      `├─ Entry Range: $${signal.entryMin} – $${signal.entryMax}\n` +
      `├─ TP Target: $${signal.tpPrice}\n` +
      `└─ SL Level: $${signal.slPrice}\n\n` +
      `We will notify you here once the take-profit or stop-loss hits!`
    );
  }

  // 4. CONVERSATIONAL FREEFORM QUERY VIA GROQ
  try {
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const resolvedSignals = await getCachedResolvedSignals();
    const systemPrompt = 
      'You are Signum, a helpful conversational AI assistant representing the Signum autonomous crypto trading signal bot. ' +
      'You answer general crypto market and trading questions. Be concise, friendly, and structure your responses using clean Markdown. ' +
      'Suggest typing "active" to query open signals, "stats" to view admin leaderboards, or "history" to view recently resolved signals. ' +
      (resolvedSignals.length > 0
        ? `Here are the recently resolved/expired signals cached in Redis that you can reference to answer user questions: ${JSON.stringify(resolvedSignals)}`
        : 'There are no recently resolved signals cached in Redis.');

    const response = await getGroq().chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: text,
        },
      ],
      max_completion_tokens: 512,
    });

    return response.choices[0]?.message?.content || 'I could not generate a response right now.';
  } catch (error: any) {
    console.error('❌ Error handling freeform query in memberInterface:', error.message);
    return '⚠️ *Signum Error*: I am having trouble answering questions right now. Try typing *active* or *stats*.';
  }
}
