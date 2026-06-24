import { Router, Request, Response } from 'express';
import { prisma } from '../../db/src/index';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

// GET /admins/stats - Retrieve statistics (win rates, totals) for all signal posting admins
router.get('/stats', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const admins = await prisma.admin.findMany({
      orderBy: {
        winRate: 'desc'
      }
    });
    res.json(admins);
  } catch (error: any) {
    console.error('Error fetching admin statistics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
