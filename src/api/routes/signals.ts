import { Router, Request, Response } from 'express';
import { prisma } from '../../db/src/index';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

// GET /signals/active - Retrieve open/pending signals
router.get('/active', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const signals = await prisma.signal.findMany({
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
  } catch (error: any) {
    console.error('Error fetching active signals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /signals/history - Retrieve resolved/expired/missed signals with support for asset and adminId filters
router.get('/history', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { asset, adminId } = req.query;
    const whereClause: any = {
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

    const signals = await prisma.signal.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        admin: true
      }
    });
    res.json(signals);
  } catch (error: any) {
    console.error('Error fetching signals history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /signals/:id - Fetch specific signal details
router.get('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }
    const signal = await prisma.signal.findUnique({
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
  } catch (error: any) {
    console.error('Error fetching signal detail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
