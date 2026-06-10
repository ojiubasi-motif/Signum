"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const index_1 = require("../../db/src/index");
const auth_1 = require("../middleware/auth");
const binance_1 = require("../../services/binance");
const router = (0, express_1.Router)();
// POST /members/register (also acts as login)
router.post('/register', async (req, res) => {
    try {
        const { whatsappNumber } = req.body;
        if (!whatsappNumber || typeof whatsappNumber !== 'string') {
            res.status(400).json({ error: 'whatsappNumber is required and must be a string' });
            return;
        }
        const cleanNumber = whatsappNumber.trim();
        // Validate format (digits only, length between 7 and 15)
        if (!/^\d{7,15}$/.test(cleanNumber)) {
            res.status(400).json({ error: 'whatsappNumber must be a valid phone number (digits only, 7-15 chars)' });
            return;
        }
        // Find or create member
        let member = await index_1.prisma.member.findUnique({
            where: { whatsappNumber: cleanNumber }
        });
        if (!member) {
            member = await index_1.prisma.member.create({
                data: {
                    whatsappNumber: cleanNumber,
                    alertsEnabled: true
                }
            });
        }
        const secret = (0, auth_1.getJwtSecret)();
        const token = jsonwebtoken_1.default.sign({ memberId: member.id, whatsappNumber: member.whatsappNumber }, secret, { algorithm: 'HS256', expiresIn: '30d' });
        res.status(200).json({
            token,
            member: {
                id: member.id,
                whatsappNumber: member.whatsappNumber,
                alertsEnabled: member.alertsEnabled,
                joinedAt: member.joinedAt
            }
        });
    }
    catch (error) {
        console.error('Error during registration/login:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /members/trade/:signalId (Authenticated) - Log a trade taken by the member
router.post('/trade/:signalId', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { signalId } = req.params;
        if (typeof signalId !== 'string') {
            res.status(400).json({ error: 'Invalid signal ID' });
            return;
        }
        const memberId = req.user.memberId;
        const signal = await index_1.prisma.signal.findUnique({
            where: { id: signalId }
        });
        if (!signal) {
            res.status(404).json({ error: 'Signal not found' });
            return;
        }
        // Check if trade is already registered
        const existingTrade = await index_1.prisma.memberTrade.findFirst({
            where: { memberId, signalId }
        });
        if (existingTrade) {
            res.status(200).json({ message: 'Trade already registered', trade: existingTrade });
            return;
        }
        // Determine initial outcome if the signal is already resolved
        let outcome = null;
        if (signal.status === 'TP_HIT')
            outcome = 'WIN';
        else if (signal.status === 'SL_HIT')
            outcome = 'LOSS';
        else if (['ENTRY_MISSED', 'EXPIRED'].includes(signal.status))
            outcome = 'MISSED';
        const trade = await index_1.prisma.memberTrade.create({
            data: {
                memberId,
                signalId,
                outcome
            }
        });
        res.status(201).json({ message: 'Trade registered successfully', trade });
    }
    catch (error) {
        console.error('Error registering trade:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /members/:id/portfolio (Authenticated + Ownership check)
router.get('/:id/portfolio', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const authenticatedMemberId = req.user.memberId;
        // Enforce strict ownership check
        if (id !== authenticatedMemberId) {
            res.status(403).json({ error: 'Forbidden: You cannot access another member\'s portfolio' });
            return;
        }
        const trades = await index_1.prisma.memberTrade.findMany({
            where: { memberId: id },
            include: {
                signal: true
            }
        });
        let winCount = 0;
        let lossCount = 0;
        let missedCount = 0;
        let completedPnL = 0;
        const completedTrades = [];
        const activeTrades = [];
        for (const trade of trades) {
            const signal = trade.signal;
            const isResolved = ['TP_HIT', 'SL_HIT', 'ENTRY_MISSED', 'EXPIRED'].includes(signal.status);
            if (isResolved) {
                if (signal.status === 'TP_HIT') {
                    winCount++;
                    completedPnL += signal.tpPercent; // simple percentage gain summation
                }
                else if (signal.status === 'SL_HIT') {
                    lossCount++;
                    completedPnL -= signal.slPercent; // simple percentage loss subtraction
                }
                else {
                    missedCount++;
                }
                completedTrades.push({
                    tradeId: trade.id,
                    signalId: signal.id,
                    asset: signal.asset,
                    direction: signal.direction,
                    status: signal.status,
                    outcome: trade.outcome,
                    tpPercent: signal.tpPercent,
                    slPercent: signal.slPercent,
                    takenAt: trade.takenAt,
                    resolvedAt: signal.resolvedAt
                });
            }
            else {
                // Active signal: calculate floating P&L using live price
                let currentPrice = null;
                let floatingPnL = 0;
                const entryPrice = signal.livePriceAtPost || ((signal.entryMin + signal.entryMax) / 2);
                try {
                    const livePrice = await (0, binance_1.getLivePrice)(signal.asset, signal.coingeckoId || undefined);
                    if (livePrice !== null) {
                        currentPrice = livePrice;
                        if (entryPrice > 0) {
                            const multiplier = signal.direction === 'BUY' ? 1 : -1;
                            floatingPnL = ((currentPrice - entryPrice) / entryPrice) * 100 * multiplier;
                        }
                    }
                }
                catch (priceErr) {
                    console.error(`Error fetching live price for portfolio item ${signal.asset}:`, priceErr.message);
                }
                activeTrades.push({
                    tradeId: trade.id,
                    signalId: signal.id,
                    asset: signal.asset,
                    direction: signal.direction,
                    status: signal.status,
                    entryPrice,
                    currentPrice,
                    floatingPnL: currentPrice ? parseFloat(floatingPnL.toFixed(2)) : 0,
                    takenAt: trade.takenAt
                });
            }
        }
        res.json({
            totalTrades: trades.length,
            winCount,
            lossCount,
            missedCount,
            completedPnLPercent: parseFloat(completedPnL.toFixed(2)),
            completedTrades,
            activeTrades
        });
    }
    catch (error) {
        console.error('Error fetching portfolio:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PUT /members/preferences (Authenticated)
router.put('/preferences', auth_1.authenticateJWT, async (req, res) => {
    try {
        const memberId = req.user.memberId;
        const { alertsEnabled, fcmToken } = req.body;
        if (alertsEnabled === undefined && fcmToken === undefined) {
            res.status(400).json({ error: 'At least one field (alertsEnabled or fcmToken) is required' });
            return;
        }
        const updateData = {};
        if (alertsEnabled !== undefined) {
            if (typeof alertsEnabled !== 'boolean') {
                res.status(400).json({ error: 'alertsEnabled must be a boolean' });
                return;
            }
            updateData.alertsEnabled = alertsEnabled;
        }
        if (fcmToken !== undefined) {
            if (fcmToken !== null && typeof fcmToken !== 'string') {
                res.status(400).json({ error: 'fcmToken must be a string or null' });
                return;
            }
            updateData.fcmToken = fcmToken;
        }
        const updatedMember = await index_1.prisma.member.update({
            where: { id: memberId },
            data: updateData
        });
        res.json({
            message: 'Preferences updated successfully',
            member: {
                id: updatedMember.id,
                whatsappNumber: updatedMember.whatsappNumber,
                alertsEnabled: updatedMember.alertsEnabled,
                fcmToken: updatedMember.fcmToken
            }
        });
    }
    catch (error) {
        console.error('Error updating preferences:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
