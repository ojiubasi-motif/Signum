import { prisma } from '../db/src/index';
import { cacheResolvedSignal } from './cache';
import { formatWhatsappNumber } from '../utils/formatter';
import { resolveCoingeckoId, getOrUpdateCoinList } from './coingecko';
import { sendWhatsappMessage } from './whatsapp';
import { sendPushNotification } from './fcm';

/**
 * Retrieves context for a specific admin. If the admin doesn't exist,
 * creates a new admin entry with default values.
 * @param adminId The admin's WhatsApp number / JID
 */
export async function getAdminContext(adminId: string) {
  let admin = await prisma.admin.findUnique({
    where: { id: adminId },
  });

  if (!admin) {
    admin = await prisma.admin.create({
      data: {
        id: adminId,
        name: formatWhatsappNumber(adminId), // Use formatted phone number/LID JID as default name
        winRate: 0,
        totalSignals: 0,
        totalWins: 0,
      },
    });
  }

  const openSignals = await prisma.signal.findMany({
    where: {
      status: {
        in: ['ENTRY_OPEN', 'PENDING'],
      },
    },
  });

  return {
    adminName: admin.name,
    adminWinRate: admin.winRate,
    openSignals,
  };
}

/**
 * Saves a parsed and enriched signal into the database.
 * @param input The signal data from the agent
 */
export async function saveSignalToDB(input: {
  adminId: string;
  asset: string;
  direction: 'BUY' | 'SELL';
  entryMin: number;
  entryMax: number;
  tpPercent: number;
  slPercent: number;
  tpPrice: number;
  slPrice: number;
  rrRatio: number;
  urgencyScore: number;
  rawText: string;
  livePriceAtPost?: number;
  messageId?: string;
  coingeckoId?: string;
}) {
  let adminId = input.adminId.trim();

  // If the model stripped the '@lid' or '@s.whatsapp.net' suffix, resolve it against existing admins
  if (!adminId.includes('@')) {
    const matchedAdmin = await prisma.admin.findFirst({
      where: {
        id: {
          startsWith: adminId,
        },
      },
    });
    if (matchedAdmin) {
      adminId = matchedAdmin.id;
    }
  }

  let coingeckoId = input.coingeckoId || null;
  let pendingCoingecko = false;
  let candidates: any[] = [];

  if (!coingeckoId) {
    const cleanAsset = input.asset.trim().toUpperCase();
    try {
      const list = await getOrUpdateCoinList();
      candidates = list.filter(c => c.symbol.toLowerCase() === cleanAsset.toLowerCase());
      
      if (candidates.length === 1) {
        coingeckoId = candidates[0].id;
      } else if (candidates.length > 1) {
        pendingCoingecko = true;
      }
    } catch (err: any) {
      console.error(`❌ db: Failed to check coingecko list for ${input.asset}:`, err.message);
    }
  }

  const signal = await prisma.signal.create({
    data: {
      messageId: input.messageId || null,
      adminId,
      asset: input.asset.toUpperCase(),
      direction: input.direction,
      entryMin: input.entryMin,
      entryMax: input.entryMax,
      tpPercent: input.tpPercent,
      slPercent: input.slPercent,
      tpPrice: input.tpPrice,
      slPrice: input.slPrice,
      rrRatio: input.rrRatio,
      urgencyScore: input.urgencyScore,
      rawText: input.rawText,
      status: pendingCoingecko ? 'PENDING' : 'ENTRY_OPEN',
      livePriceAtPost: input.livePriceAtPost || null,
      coingeckoId,
      enrichment: pendingCoingecko ? { coingeckoCandidates: candidates } : undefined,
    },
  });

  if (pendingCoingecko && candidates.length > 0) {
    const cleanAsset = input.asset.trim().toUpperCase();
    const slicedCandidates = candidates.slice(0, 50);
    const promptText = `🔍 *Multiple Coins Found for ${cleanAsset}*
I found ${candidates.length} coins matching the symbol *${cleanAsset}* in the CoinGecko cache. Please reply with the number of the correct coin:

${slicedCandidates.map((c, i) => `${i + 1}. *${c.name}* (${c.id})`).join('\n')}

${candidates.length > 50 ? '\n_(showing first 50 candidates)_\n' : ''}
Reply with the corresponding number to activate this signal.`;
    
    await sendWhatsappMessage(adminId, promptText);
  }

  return signal.id;
}

/**
 * Processes the selection made by the admin in DM for a pending signal.
 */
export async function processAdminCoingeckoChoice(
  remoteJid: string,
  text: string,
  sendMessageFn?: (jid: string, text: string) => Promise<any>
): Promise<boolean> {
  const pendingSignal = await prisma.signal.findFirst({
    where: {
      adminId: remoteJid,
      status: 'PENDING',
      coingeckoId: null
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  if (!pendingSignal || !pendingSignal.enrichment) {
    return false;
  }

  const enrichment = pendingSignal.enrichment as any;
  const candidates = enrichment.coingeckoCandidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return false;
  }

  const choiceIndex = parseInt(text.trim(), 10) - 1;
  if (!isNaN(choiceIndex) && choiceIndex >= 0 && choiceIndex < candidates.length) {
    const selectedCoin = candidates[choiceIndex];

    // Update signal
    await prisma.signal.update({
      where: { id: pendingSignal.id },
      data: {
        coingeckoId: selectedCoin.id,
        status: 'ENTRY_OPEN'
      }
    });

    // Send member notification alert
    const alertMsg = `🚀 *NEW SIGNAL*: ${pendingSignal.direction} ${pendingSignal.asset} at ${pendingSignal.entryMin}-${pendingSignal.entryMax}`;
    await sendPushNotification({
      signalId: pendingSignal.id,
      urgencyScore: pendingSignal.urgencyScore,
      message: alertMsg
    });

    if (sendMessageFn) {
      await sendMessageFn(remoteJid, `✅ CoinGecko ID resolved to *${selectedCoin.name}* (${selectedCoin.id}). Signal is now active and members have been notified!`);
      const groupJid = process.env.TARGET_GROUP_ID || '1234567890@g.us';
      await sendMessageFn(groupJid, `📈 *Signal Activated*: ${pendingSignal.direction} ${pendingSignal.asset} (CoinGecko: ${selectedCoin.name})`);
    }

    return true;
  } else {
    if (sendMessageFn) {
      await sendMessageFn(remoteJid, `⚠️ Invalid selection. Please reply with a number between 1 and ${candidates.length} corresponding to the options above.`);
    }
    return true; // Still intercept/process since it is a choice command
  }
}

/**
 * Updates the status of an existing signal in the database.
 * @param signalId The unique ID of the signal
 * @param status The new status value
 */
export async function updateStatus(signalId: string, status: 'ENTRY_OPEN' | 'ENTRY_MISSED' | 'TP_HIT' | 'SL_HIT' | 'EXPIRED') {
  const isResolved = ['ENTRY_MISSED', 'TP_HIT', 'SL_HIT', 'EXPIRED'].includes(status);
  
  const updatedSignal = await prisma.signal.update({
    where: { id: signalId },
    data: {
      status,
      resolvedAt: isResolved ? new Date() : null,
    },
    include: {
      admin: true,
    },
  });

  if (isResolved) {
    // 1. Update outcome of member trades registered for this signal
    let outcome: string | null = null;
    if (status === 'TP_HIT') outcome = 'WIN';
    else if (status === 'SL_HIT') outcome = 'LOSS';
    else if (status === 'ENTRY_MISSED' || status === 'EXPIRED') outcome = 'MISSED';

    if (outcome) {
      await prisma.memberTrade.updateMany({
        where: { signalId },
        data: { outcome },
      });
    }

    // 2. Recalculate stats for the admin
    const adminId = updatedSignal.adminId;
    const allAdminSignals = await prisma.signal.findMany({
      where: { adminId },
    });

    const totalSignals = allAdminSignals.filter(s => s.status !== 'EXPIRED' && s.status !== 'PENDING').length;
    const totalWins = allAdminSignals.filter(s => s.status === 'TP_HIT').length;
    const resolvedTradeSignals = allAdminSignals.filter(s => s.status === 'TP_HIT' || s.status === 'SL_HIT').length;
    const winRate = resolvedTradeSignals > 0 ? (totalWins / resolvedTradeSignals) * 100 : 0;

    await prisma.admin.update({
      where: { id: adminId },
      data: {
        totalSignals,
        totalWins,
        winRate,
      },
    });

    // 3. Cache the resolved signal in Redis
    if (['TP_HIT', 'SL_HIT', 'EXPIRED'].includes(status)) {
      await cacheResolvedSignal(updatedSignal).catch(err => {
        console.error(`❌ db: Failed to cache resolved signal ${signalId} in Redis:`, err.message);
      });
    }
  }

  return true;
}

/**
 * Updates an active signal's parameters in the database.
 * @param input The updated parameters
 */
export async function adjustSignalInDB(input: {
  signalId: string;
  entryMin?: number;
  entryMax?: number;
  tpPercent?: number;
  slPercent?: number;
  tpPrice?: number;
  slPrice?: number;
  rrRatio?: number;
  rawText?: string;
}) {
  const dataToUpdate: any = {};
  if (input.entryMin !== undefined) dataToUpdate.entryMin = input.entryMin;
  if (input.entryMax !== undefined) dataToUpdate.entryMax = input.entryMax;
  if (input.tpPercent !== undefined) dataToUpdate.tpPercent = input.tpPercent;
  if (input.slPercent !== undefined) dataToUpdate.slPercent = input.slPercent;
  if (input.tpPrice !== undefined) dataToUpdate.tpPrice = input.tpPrice;
  if (input.slPrice !== undefined) dataToUpdate.slPrice = input.slPrice;
  if (input.rrRatio !== undefined) dataToUpdate.rrRatio = input.rrRatio;
  if (input.rawText !== undefined) dataToUpdate.rawText = input.rawText;

  const updated = await prisma.signal.update({
    where: { id: input.signalId },
    data: dataToUpdate,
  });

  return updated;
}
