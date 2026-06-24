import { getLivePrice } from '../services/binance';
import { saveSignalToDB, updateStatus, adjustSignalInDB, flagSignalForReview } from '../services/db';
import { sendPushNotification } from '../services/fcm';
import { prisma } from '../db/src/index';

/**
 * Executes an agent tool request by routing it to the appropriate service.
 * @param name The name of the tool to execute
 * @param input The inputs provided by the agent
 */
export async function executeTool(name: string, input: any): Promise<any> {
  console.log(`🛠️ Executing tool: [${name}] with input: ${JSON.stringify(input)}`);

  switch (name) {
    case 'get_live_price':
      const price = await getLivePrice(input.asset);
      return { price };

    case 'save_signal':
      const signalId = await saveSignalToDB(input);
      const signal = await prisma.signal.findUnique({
        where: { id: signalId },
        select: { status: true }
      });
      return {
        signalId,
        pendingCoingecko: signal?.status === 'PENDING'
      };

    case 'notify_members':
      const sent = await sendPushNotification(input);
      return { sent };

    case 'update_signal_status':
      const updated = await updateStatus(input.signalId, input.status);
      return { updated };

    case 'adjust_signal':
      const adjusted = await adjustSignalInDB(input);
      return { adjusted: !!adjusted };

    case 'flag_for_review':
      const reviewSignalId = await flagSignalForReview(input);
      return { signalId: reviewSignalId, flaggedForReview: true };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
