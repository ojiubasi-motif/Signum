import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface AuthenticatedRequest extends Request {
  user?: {
    memberId: string;
    whatsappNumber: string;
  };
}

export function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  console.warn('[Security Warning] JWT_SECRET is not set in environment variables. Using an ephemeral random secret key (not scalable horizontally).');
  if (!(global as any).ephemeralJwtSecret) {
    (global as any).ephemeralJwtSecret = crypto.randomBytes(32).toString('hex');
  }
  return (global as any).ephemeralJwtSecret;
}

export function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Access token is required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Malformed authorization header' });
    return;
  }

  try {
    const secret = getJwtSecret();
    // Verify using HS256 algorithm explicitly as required by security guidelines
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as {
      memberId: string;
      whatsappNumber: string;
    };

    req.user = {
      memberId: decoded.memberId,
      whatsappNumber: decoded.whatsappNumber
    };
    next();
  } catch (err: any) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}
