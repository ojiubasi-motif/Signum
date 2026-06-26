import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import signalsRouter from './routes/signals';
import adminsRouter from './routes/admins';
import membersRouter from './routes/members';

const app = express();

// 1. JSON body parsing
app.use(express.json());

// 1b. Cookie parser (required for reading httpOnly refresh token cookie)
app.use(cookieParser());

// 2. Custom Security Headers Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none';");
  next();
});

// 3. Strict CORS Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5173']; // default frontend dev url

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// 4. In-Memory Token Bucket / Window Rate-Limiter
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // max 100 requests/min

app.use((req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = rateLimits.get(ip);

  if (!record || now > record.resetAt) {
    rateLimits.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW
    });
    next();
  } else {
    record.count++;
    if (record.count > MAX_REQUESTS) {
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    } else {
      next();
    }
  }
});

// 5. Mount Sub-Routers
app.use('/signals', signalsRouter);
app.use('/admins', adminsRouter);
app.use('/members', membersRouter);

// 6. 404 Route handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// 7. Global Secure Error Handler (prevents leaking database stack traces/SQL details)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled API Server Error:', err.message || err);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

// Start listening function
export function startApiServer() {
  const port = parseInt(process.env.PORT || '3000', 10);
  // Default to localhost/127.0.0.1 when testing, allow binding to 0.0.0.0 inside container / production environment
  const host = process.env.BIND_ALL === 'true' || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

  const server = app.listen(port, host, () => {
    console.log(`🌐 REST API Server running at http://${host}:${port}`);
  });

  return server;
}
