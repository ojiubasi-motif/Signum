"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../../db/src/index");
const router = (0, express_1.Router)();
// GET /signals/active - Retrieve open/pending signals
router.get('/active', async (req, res) => {
    try {
        const signals = await index_1.prisma.signal.findMany({
            where: {
                status: {
                    in: ['ENTRY_OPEN', 'PENDING']
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                admin: true
            }
        });
        res.json(signals);
    }
    catch (error) {
        console.error('Error fetching active signals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /signals/history - Retrieve resolved/expired/missed signals with support for asset and adminId filters
router.get('/history', async (req, res) => {
    try {
        const { asset, adminId } = req.query;
        const whereClause = {
            status: {
                in: ['TP_HIT', 'SL_HIT', 'ENTRY_MISSED', 'EXPIRED']
            }
        };
        if (asset && typeof asset === 'string') {
            whereClause.asset = asset.toUpperCase().trim();
        }
        if (adminId && typeof adminId === 'string') {
            whereClause.adminId = adminId.trim();
        }
        const signals = await index_1.prisma.signal.findMany({
            where: whereClause,
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                admin: true
            }
        });
        res.json(signals);
    }
    catch (error) {
        console.error('Error fetching signals history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /signals/:id - Fetch specific signal details
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (typeof id !== 'string') {
            res.status(400).json({ error: 'Invalid ID' });
            return;
        }
        const signal = await index_1.prisma.signal.findUnique({
            where: { id },
            include: {
                admin: true
            }
        });
        if (!signal) {
            res.status(404).json({ error: 'Signal not found' });
            return;
        }
        res.json(signal);
    }
    catch (error) {
        console.error('Error fetching signal detail:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
