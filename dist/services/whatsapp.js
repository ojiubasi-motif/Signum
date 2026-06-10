"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setWhatsappSocket = setWhatsappSocket;
exports.getWhatsappSocket = getWhatsappSocket;
exports.sendWhatsappMessage = sendWhatsappMessage;
let socketInstance = null;
function setWhatsappSocket(sock) {
    socketInstance = sock;
}
function getWhatsappSocket() {
    return socketInstance;
}
/**
 * Sends a WhatsApp message to a specific JID.
 * Logs a message if the socket is not initialized.
 */
async function sendWhatsappMessage(jid, text) {
    if (!socketInstance) {
        console.warn(`⚠️ WhatsApp Service: Cannot send message to ${jid}, socket not initialized. Msg: "${text}"`);
        return false;
    }
    try {
        await socketInstance.sendMessage(jid, { text });
        console.log(`📤 WhatsApp Service: Sent message to ${jid}`);
        return true;
    }
    catch (error) {
        console.error(`❌ WhatsApp Service: Failed to send message to ${jid}:`, error.message);
        return false;
    }
}
