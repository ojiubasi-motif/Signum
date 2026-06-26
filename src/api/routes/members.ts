import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/src/index';
import { authenticateJWT, AuthenticatedRequest, getJwtSecret, getRefreshSecret } from '../middleware/auth';
import { getLivePrice } from '../../services/binance';
import { formatWhatsappNumber } from '../../utils/formatter';
import { redisConnection } from '../../config/redis';
import { sendWhatsappMessage } from '../../services/whatsapp';
import { ADMIN_NUMBERS } from '../../config/constants';
import crypto from 'crypto';

/** Access token lifetime: 5 minutes */
const ACCESS_TOKEN_EXPIRY = '5m';
/** Refresh token lifetime: 30 days */
const REFRESH_TOKEN_EXPIRY_SECS = 60 * 60 * 24 * 30; // 30 days in seconds
const REFRESH_TOKEN_EXPIRY_JWT = '30d';

/** Cookie name for the refresh token */
const REFRESH_COOKIE = 'signum_rt';

/** SHA-256 hash utility — we never store raw refresh tokens */
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Compare two strings in constant time to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Determine if we're in a production-like environment */
const isProduction = process.env.NODE_ENV === 'production';

/** Helper to set the refresh token httpOnly cookie */
function setRefreshCookie(res: Response, rawToken: string) {
  res.cookie(REFRESH_COOKIE, rawToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/members/auth/refresh',
    maxAge: REFRESH_TOKEN_EXPIRY_SECS * 1000,
  });
}

/** Helper to clear the refresh token cookie */
function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/members/auth/refresh',
  });
}

const router = Router();

// POST /members/request-otp - Generate and send OTP via WhatsApp bot
router.post('/request-otp', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { whatsappNumber } = req.body;

    if (!whatsappNumber || typeof whatsappNumber !== 'string') {
      res.status(400).json({ error: 'whatsappNumber is required and must be a string' });
      return;
    }

    const cleanNumber = whatsappNumber.trim().replace(/\D/g, '');
    // Validate format (digits only, length between 7 and 15)
    if (!/^\d{7,15}$/.test(cleanNumber)) {
      res.status(400).json({ error: 'whatsappNumber must be a valid phone number (digits only, 7-15 chars)' });
      return;
    }

    const normalizedNumber = formatWhatsappNumber(`${cleanNumber}@s.whatsapp.net`);

    // 1. Authorize: check if member exists in DB (synced from group) or is an admin JID
    const member = await prisma.member.findUnique({
      where: { whatsappNumber: normalizedNumber }
    });

    const matchingAdminJid = ADMIN_NUMBERS.find(adminJid => {
      return formatWhatsappNumber(adminJid) === normalizedNumber;
    });

    if (!member && !matchingAdminJid) {
      res.status(403).json({ error: 'Access Denied: You must be an active member of the official Signum WhatsApp group.' });
      return;
    }

    // 2. Generate secure 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();

    // 3. Store OTP in Redis with 5-minute expiration (300 seconds)
    const redisKey = `otp:${normalizedNumber}`;
    await redisConnection.setex(redisKey, 300, otp);

    // 4. Send OTP via WhatsApp
    const jid = matchingAdminJid || `${cleanNumber}@s.whatsapp.net`;
    const messageText = `🔒 *Signum Verification Code* 🔒\n\nYour 6-digit one-time verification code is:\n\n*${otp}*\n\nThis code will expire in 5 minutes. Do not share this code with anyone.`;
    
    const sent = await sendWhatsappMessage(jid, messageText);
    if (!sent) {
      res.status(500).json({ error: 'Failed to send verification message. Please ensure the WhatsApp bot is running.' });
      return;
    }

    res.status(200).json({ message: 'Verification code sent successfully to your WhatsApp DM.' });
  } catch (error: any) {
    console.error('Error in request-otp:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /members/verify-otp - Verify OTP and issue JWT token
router.post('/verify-otp', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { whatsappNumber, code } = req.body;

    if (!whatsappNumber || typeof whatsappNumber !== 'string' || !code || typeof code !== 'string') {
      res.status(400).json({ error: 'whatsappNumber and code are required and must be strings' });
      return;
    }

    const cleanNumber = whatsappNumber.trim().replace(/\D/g, '');
    const cleanCode = code.trim();

    if (!/^\d{7,15}$/.test(cleanNumber)) {
      res.status(400).json({ error: 'whatsappNumber must be a valid phone number (digits only, 7-15 chars)' });
      return;
    }

    const normalizedNumber = formatWhatsappNumber(`${cleanNumber}@s.whatsapp.net`);

    // 1. Retrieve OTP from Redis
    const redisKey = `otp:${normalizedNumber}`;
    const cachedOtp = await redisConnection.get(redisKey);

    if (!cachedOtp) {
      res.status(400).json({ error: 'Verification code has expired or was not requested. Please request a new code.' });
      return;
    }

    // 2. Verify OTP code
    if (cachedOtp !== cleanCode) {
      res.status(401).json({ error: 'Invalid verification code. Please check the code and try again.' });
      return;
    }

    // 3. OTP verified, delete it from Redis to prevent replay
    await redisConnection.del(redisKey);

    // 4. Find or create member
    let member = await prisma.member.findUnique({
      where: { whatsappNumber: normalizedNumber }
    });

    if (!member) {
      // If they are an admin not in the member table, auto-create a member record for them
      const isAdmin = ADMIN_NUMBERS.some(adminJid => formatWhatsappNumber(adminJid) === normalizedNumber);
      if (isAdmin) {
        member = await prisma.member.create({
          data: {
            whatsappNumber: normalizedNumber,
            alertsEnabled: true
          }
        });
      } else {
        res.status(403).json({ error: 'Access Denied: You must be an active member of the official Signum WhatsApp group.' });
        return;
      }
    }

    // 5. Sign short-lived access token (5 min)
    const accessToken = jwt.sign(
      { memberId: member.id, whatsappNumber: member.whatsappNumber },
      getJwtSecret(),
      { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // 6. Sign refresh token (30 days) and store its hash in the DB
    const rawRefreshToken = jwt.sign(
      { memberId: member.id, sub: 'refresh' },
      getRefreshSecret(),
      { algorithm: 'HS256', expiresIn: REFRESH_TOKEN_EXPIRY_JWT }
    );
    await prisma.member.update({
      where: { id: member.id },
      data: { refreshToken: hashToken(rawRefreshToken) }
    });

    // 7. Set refresh token in httpOnly cookie (not accessible via JS)
    setRefreshCookie(res, rawRefreshToken);

    res.status(200).json({
      access_token: accessToken,
      member: {
        id: member.id,
        whatsappNumber: member.whatsappNumber,
        alertsEnabled: member.alertsEnabled,
        joinedAt: member.joinedAt
      }
    });
  } catch (error: any) {
    console.error('Error in verify-otp:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /members/auth/refresh - Silent session restore via httpOnly cookie
router.get('/auth/refresh', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawToken: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!rawToken) {
      res.status(401).json({ error: 'No refresh token' });
      return;
    }

    // 1. Verify the refresh token JWT
    let payload: { memberId: string; sub: string };
    try {
      payload = jwt.verify(rawToken, getRefreshSecret(), { algorithms: ['HS256'] }) as {
        memberId: string;
        sub: string;
      };
    } catch {
      clearRefreshCookie(res);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    if (payload.sub !== 'refresh') {
      clearRefreshCookie(res);
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }

    // 2. Load member and compare the stored hash in constant time
    const member = await prisma.member.findUnique({
      where: { id: payload.memberId },
      select: { id: true, whatsappNumber: true, alertsEnabled: true, joinedAt: true, refreshToken: true },
    });
    if (!member || !member.refreshToken) {
      clearRefreshCookie(res);
      res.status(401).json({ error: 'Session revoked' });
      return;
    }

    if (!safeCompare(hashToken(rawToken), member.refreshToken)) {
      // Token does not match — possible theft; revoke all
      await prisma.member.update({ where: { id: member.id }, data: { refreshToken: null } });
      clearRefreshCookie(res);
      res.status(401).json({ error: 'Session revoked' });
      return;
    }

    // 3. Rotate: issue new access + refresh token pair
    const newAccessToken = jwt.sign(
      { memberId: member.id, whatsappNumber: member.whatsappNumber },
      getJwtSecret(),
      { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_EXPIRY }
    );
    const newRawRefreshToken = jwt.sign(
      { memberId: member.id, sub: 'refresh' },
      getRefreshSecret(),
      { algorithm: 'HS256', expiresIn: REFRESH_TOKEN_EXPIRY_JWT }
    );
    await prisma.member.update({
      where: { id: member.id },
      data: { refreshToken: hashToken(newRawRefreshToken) }
    });
    setRefreshCookie(res, newRawRefreshToken);

    res.status(200).json({
      access_token: newAccessToken,
      member: {
        id: member.id,
        whatsappNumber: member.whatsappNumber,
        alertsEnabled: member.alertsEnabled,
        joinedAt: member.joinedAt
      }
    });
  } catch (error: any) {
    console.error('Error in /auth/refresh:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /members/auth/logout - Revoke refresh token and clear cookie
router.post('/auth/logout', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.member.update({
      where: { id: req.user!.memberId },
      data: { refreshToken: null }
    });
    clearRefreshCookie(res);
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error: any) {
    console.error('Error in /auth/logout:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /members/me - Return authenticated member's profile
router.get('/me', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const member = await prisma.member.findUnique({
      where: { id: req.user!.memberId },
      select: { id: true, whatsappNumber: true, alertsEnabled: true, fcmToken: true, joinedAt: true }
    });
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    res.json({ member });
  } catch (error: any) {
    console.error('Error in /me:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /members/trade/:signalId (Authenticated) - Log a trade taken by the member
router.post('/trade/:signalId', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { signalId } = req.params;
    if (typeof signalId !== 'string') {
      res.status(400).json({ error: 'Invalid signal ID' });
      return;
    }
    const memberId = req.user!.memberId;

    const signal = await prisma.signal.findUnique({
      where: { id: signalId }
    });

    if (!signal) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }

    // Check if trade is already registered
    const existingTrade = await prisma.memberTrade.findFirst({
      where: { memberId, signalId }
    });

    if (existingTrade) {
      res.status(200).json({ message: 'Trade already registered', trade: existingTrade });
      return;
    }

    // Determine initial outcome if the signal is already resolved
    let outcome: string | null = null;
    if (signal.status === 'TP_HIT') outcome = 'WIN';
    else if (signal.status === 'SL_HIT') outcome = 'LOSS';
    else if (signal.status === 'ENTRY_MISSED') outcome = 'MISSED';
    else if (signal.status === 'EXPIRED') outcome = 'CANCELED';

    const trade = await prisma.memberTrade.create({
      data: {
        memberId,
        signalId,
        outcome
      }
    });

    res.status(201).json({ message: 'Trade registered successfully', trade });
  } catch (error: any) {
    console.error('Error registering trade:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /members/:id/portfolio (Authenticated + Ownership check)
router.get('/:id/portfolio', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const authenticatedMemberId = req.user!.memberId;

    // Enforce strict ownership check
    if (id !== authenticatedMemberId) {
      res.status(403).json({ error: 'Forbidden: You cannot access another member\'s portfolio' });
      return;
    }

    const trades = await prisma.memberTrade.findMany({
      where: { memberId: id },
      include: {
        signal: true
      }
    });

    let winCount = 0;
    let lossCount = 0;
    let missedCount = 0;
    let canceledCount = 0;
    let completedPnL = 0;
    let totalValidTrades = 0;

    const completedTrades: any[] = [];
    const activeTrades: any[] = [];

    for (const trade of trades) {
      const signal = trade.signal;
      const isResolved = ['TP_HIT', 'SL_HIT', 'ENTRY_MISSED', 'EXPIRED'].includes(signal.status);

      if (isResolved) {
        if (signal.status === 'EXPIRED') {
          canceledCount++;
          completedTrades.push({
            tradeId: trade.id,
            signalId: signal.id,
            asset: signal.asset,
            direction: signal.direction,
            status: signal.status,
            outcome: 'CANCELED',
            tpPercent: signal.tpPercent,
            slPercent: signal.slPercent,
            takenAt: trade.takenAt,
            resolvedAt: signal.resolvedAt
          });
          continue;
        }

        totalValidTrades++;

        if (signal.status === 'TP_HIT') {
          winCount++;
          completedPnL += signal.tpPercent; // simple percentage gain summation
        } else if (signal.status === 'SL_HIT') {
          lossCount++;
          completedPnL -= signal.slPercent; // simple percentage loss subtraction
        } else {
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
      } else {
        totalValidTrades++;
        // Active signal: calculate floating P&L using live price
        let currentPrice: number | null = null;
        let floatingPnL = 0;
        const entryPrice = signal.livePriceAtPost || ((signal.entryMin + signal.entryMax) / 2);

        try {
          const livePrice = await getLivePrice(signal.asset, signal.coingeckoId || undefined);
          if (livePrice !== null) {
            currentPrice = livePrice;
            if (entryPrice > 0) {
              const multiplier = signal.direction === 'BUY' ? 1 : -1;
              floatingPnL = ((currentPrice - entryPrice) / entryPrice) * 100 * multiplier;
            }
          }
        } catch (priceErr: any) {
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
      totalTrades: totalValidTrades,
      winCount,
      lossCount,
      missedCount,
      canceledCount,
      completedPnLPercent: parseFloat(completedPnL.toFixed(2)),
      completedTrades,
      activeTrades
    });
  } catch (error: any) {
    console.error('Error fetching portfolio:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /members/preferences (Authenticated)
router.put('/preferences', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const memberId = req.user!.memberId;
    const { alertsEnabled, fcmToken } = req.body;

    if (alertsEnabled === undefined && fcmToken === undefined) {
      res.status(400).json({ error: 'At least one field (alertsEnabled or fcmToken) is required' });
      return;
    }

    const updateData: any = {};
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

    const updatedMember = await prisma.member.update({
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
  } catch (error: any) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
