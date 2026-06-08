import { getLivePrice } from '../services/binance';
import { saveSignalToDB, updateStatus } from '../services/db';
import { sendPushNotification } from '../services/fcm';

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
      return { signalId };

    case 'notify_members':
      const sent = await sendPushNotification(input);
      return { sent };

    case 'update_signal_status':
      const updated = await updateStatus(input.signalId, input.status);
      return { updated };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
