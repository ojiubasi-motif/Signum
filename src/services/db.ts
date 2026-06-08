import { prisma } from '../db/src/index';
import { cacheResolvedSignal } from './cache';

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
        name: adminId.split('@')[0], // Use part of phone number/LID JID as default name
        winRate: 0,
        totalSignals: 0,
        totalWins: 0,
      },
    });
  }

  const openSignals = await prisma.signal.findMany({
    where: {
      adminId,
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

  const signal = await prisma.signal.create({
    data: {
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
      status: 'ENTRY_OPEN', // Sets it straight to open entry zone
      livePriceAtPost: input.livePriceAtPost || null,
    },
  });

  return signal.id;
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

  if (isResolved && ['TP_HIT', 'SL_HIT', 'EXPIRED'].includes(status)) {
    await cacheResolvedSignal(updatedSignal).catch(err => {
      console.error(`❌ db: Failed to cache resolved signal ${signalId} in Redis:`, err.message);
    });
  }

  return true;
}
