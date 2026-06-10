"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeTool = executeTool;
const binance_1 = require("../services/binance");
const db_1 = require("../services/db");
const fcm_1 = require("../services/fcm");
const index_1 = require("../db/src/index");
/**
 * Executes an agent tool request by routing it to the appropriate service.
 * @param name The name of the tool to execute
 * @param input The inputs provided by the agent
 */
async function executeTool(name, input) {
    console.log(`🛠️ Executing tool: [${name}] with input: ${JSON.stringify(input)}`);
    switch (name) {
        case 'get_live_price':
            const price = await (0, binance_1.getLivePrice)(input.asset);
            return { price };
        case 'save_signal':
            const signalId = await (0, db_1.saveSignalToDB)(input);
            const signal = await index_1.prisma.signal.findUnique({
                where: { id: signalId },
                select: { status: true }
            });
            return {
                signalId,
                pendingCoingecko: signal?.status === 'PENDING'
            };
        case 'notify_members':
            const sent = await (0, fcm_1.sendPushNotification)(input);
            return { sent };
        case 'update_signal_status':
            const updated = await (0, db_1.updateStatus)(input.signalId, input.status);
            return { updated };
        case 'adjust_signal':
            const adjusted = await (0, db_1.adjustSignalInDB)(input);
            return { adjusted: !!adjusted };
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
