"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = sendPushNotification;
/**
 * Stubs push notifications via FCM.
 * Logs the generated alert to the console for testing and verification.
 * @param input The notification content
 */
async function sendPushNotification(input) {
    console.log(`\n🔔 [FCM PUSH NOTIFICATION SENT]`);
    console.log(`   ├─ Signal ID:     ${input.signalId}`);
    console.log(`   ├─ Urgency Score: ${input.urgencyScore}/10`);
    console.log(`   └─ Alert Message: "${input.message}"\n`);
    return true;
}
