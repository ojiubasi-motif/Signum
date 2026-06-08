import { prisma } from '../db/src/index';
import { TARGET_GROUP_ID } from '../config/constants';

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

    const currentGroupParticipantJids = metadata.participants.map((p: any) => p.id);
    console.log(`👥 groupSync: Found ${currentGroupParticipantJids.length} active participant(s) in WhatsApp group.`);

    // 2. Fetch currently registered members from database
    const registeredMembers = await prisma.member.findMany({
      select: { whatsappNumber: true },
    });
    const registeredMemberJids = registeredMembers.map(m => m.whatsappNumber);

    // 3. Find JIDs to add and JIDs to remove
    const jidsToAdd = currentGroupParticipantJids.filter((jid: string) => !registeredMemberJids.includes(jid));
    const jidsToRemove = registeredMemberJids.filter((jid: string) => !currentGroupParticipantJids.includes(jid));

    // 4. Perform database mutations
    if (jidsToAdd.length > 0) {
      console.log(`👥 groupSync: Adding ${jidsToAdd.length} new member(s) to DB...`);
      await prisma.member.createMany({
        data: jidsToAdd.map((jid: string) => ({ whatsappNumber: jid })),
        skipDuplicates: true,
      });
    }

    if (jidsToRemove.length > 0) {
      console.log(`👥 groupSync: Removing ${jidsToRemove.length} inactive member(s) from DB...`);
      // First delete associated MemberTrades to prevent constraint violations
      await prisma.memberTrade.deleteMany({
        where: {
          member: {
            whatsappNumber: { in: jidsToRemove },
          },
        },
      });

      // Delete Member records
      await prisma.member.deleteMany({
        where: {
          whatsappNumber: { in: jidsToRemove },
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
