"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../../db/src/index");
const router = (0, express_1.Router)();
// GET /admins/stats - Retrieve statistics (win rates, totals) for all signal posting admins
router.get('/stats', async (req, res) => {
    try {
        const admins = await index_1.prisma.admin.findMany({
            orderBy: {
                winRate: 'desc'
            }
        });
        res.json(admins);
    }
    catch (error) {
        console.error('Error fetching admin statistics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
