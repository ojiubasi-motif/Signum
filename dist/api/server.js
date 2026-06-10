"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startApiServer = startApiServer;
const express_1 = __importDefault(require("express"));
const signals_1 = __importDefault(require("./routes/signals"));
const admins_1 = __importDefault(require("./routes/admins"));
const members_1 = __importDefault(require("./routes/members"));
const app = (0, express_1.default)();
// 1. JSON body parsing
app.use(express_1.default.json());
// 2. Custom Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none';");
    next();
});
// 3. Strict CORS Middleware
app.use((req, res, next) => {
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
    }
    else {
        next();
    }
});
// 4. In-Memory Token Bucket / Window Rate-Limiter
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // max 100 requests/min
app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = rateLimits.get(ip);
    if (!record || now > record.resetAt) {
        rateLimits.set(ip, {
            count: 1,
            resetAt: now + RATE_LIMIT_WINDOW
        });
        next();
    }
    else {
        record.count++;
        if (record.count > MAX_REQUESTS) {
            res.status(429).json({ error: 'Too many requests, please try again later.' });
        }
        else {
            next();
        }
    }
});
// 5. Mount Sub-Routers
app.use('/signals', signals_1.default);
app.use('/admins', admins_1.default);
app.use('/members', members_1.default);
// 6. 404 Route handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});
// 7. Global Secure Error Handler (prevents leaking database stack traces/SQL details)
app.use((err, req, res, next) => {
    console.error('Unhandled API Server Error:', err.message || err);
    res.status(500).json({ error: 'An unexpected error occurred' });
});
// Start listening function
function startApiServer() {
    const port = parseInt(process.env.PORT || '3000', 10);
    // Default to localhost/127.0.0.1 when testing, allow binding to 0.0.0.0 inside container / production environment
    const host = process.env.BIND_ALL === 'true' || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
    const server = app.listen(port, host, () => {
        console.log(`🌐 REST API Server running at http://${host}:${port}`);
    });
    return server;
}
