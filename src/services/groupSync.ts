import { prisma } from '../db/src/index';
import { TARGET_GROUP_ID } from '../config/constants';
import { LID_TO_PHONE_CACHE, formatWhatsappNumber } from '../utils/formatter';

let syncInProgress = false;

/**
 * Synchronizes the WhatsApp group participant JIDs with the database Member table.
 * Adds new members, and removes members who have left the group.
 * @param sock The active Baileys socket connection instance
 */
export async function syncGroupParticipants(sock: any): Promise<boolean> {
  if (syncInProgress) {
    console.log('👥 groupSync: Sync is already in progress, skipping...');
    return false;
  }

  syncInProgress = true;
  console.log(`👥 groupSync: Starting group participant sync for group ${TARGET_GROUP_ID}...`);

  try {
    // 1. Fetch current group metadata and participants from WhatsApp
    const metadata = await sock.groupMetadata(TARGET_GROUP_ID);
    if (!metadata || !metadata.participants) {
      throw new Error('Could not retrieve participants list from group metadata.');
    }

    // Populate dynamic LID-to-Phone number mapping cache from Baileys participants metadata
    for (const p of metadata.participants) {
      if (p.id && p.jid) {
        const rawLid = p.id.split('@')[0];
        const rawPhone = p.jid.split('@')[0];
        LID_TO_PHONE_CACHE.set(rawLid, rawPhone);
      }
    }

    const currentGroupParticipantNumbers = metadata.participants.map((p: any) => formatWhatsappNumber(p.jid || p.id));
    console.log(`👥 groupSync: Found ${currentGroupParticipantNumbers.length} active participant(s) in WhatsApp group.`);

    // 2. Fetch currently registered members from database
    const registeredMembers = await prisma.member.findMany({
      select: { whatsappNumber: true },
    });
    const registeredMemberNumbers = registeredMembers.map(m => m.whatsappNumber);

    // 3. Find formatted numbers to add and remove
    const numbersToAdd = currentGroupParticipantNumbers.filter((num: string) => !registeredMemberNumbers.includes(num));
    const numbersToRemove = registeredMemberNumbers.filter((num: string) => !currentGroupParticipantNumbers.includes(num));

    // 4. Perform database mutations
    if (numbersToAdd.length > 0) {
      console.log(`👥 groupSync: Adding ${numbersToAdd.length} new member(s) to DB...`);
      await prisma.member.createMany({
        data: numbersToAdd.map((num: string) => ({ whatsappNumber: num })),
        skipDuplicates: true,
      });
    }

    if (numbersToRemove.length > 0) {
      console.log(`👥 groupSync: Removing ${numbersToRemove.length} inactive member(s) from DB...`);
      // First delete associated MemberTrades to prevent constraint violations
      await prisma.memberTrade.deleteMany({
        where: {
          member: {
            whatsappNumber: { in: numbersToRemove },
          },
        },
      });

      // Delete Member records
      await prisma.member.deleteMany({
        where: {
          whatsappNumber: { in: numbersToRemove },
        },
      });
    }

    console.log(`👥 groupSync: Synchronization completed successfully.`);
    return true;
  } catch (error: any) {
    console.error('❌ groupSync: Error synchronizing group participants:', error.message);
    return false;
  } finally {
    syncInProgress = false;
  }
}
