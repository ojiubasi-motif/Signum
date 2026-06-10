let socketInstance: any = null;

export function setWhatsappSocket(sock: any) {
  socketInstance = sock;
}

export function getWhatsappSocket() {
  return socketInstance;
}

/**
 * Sends a WhatsApp message to a specific JID.
 * Logs a message if the socket is not initialized.
 */
export async function sendWhatsappMessage(jid: string, text: string): Promise<boolean> {
  if (!socketInstance) {
    console.warn(`⚠️ WhatsApp Service: Cannot send message to ${jid}, socket not initialized. Msg: "${text}"`);
    return false;
  }

  try {
    await socketInstance.sendMessage(jid, { text });
    console.log(`📤 WhatsApp Service: Sent message to ${jid}`);
    return true;
  } catch (error: any) {
    console.error(`❌ WhatsApp Service: Failed to send message to ${jid}:`, error.message);
    return false;
  }
}
