"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJwtSecret = getJwtSecret;
exports.authenticateJWT = authenticateJWT;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
function getJwtSecret() {
    if (process.env.JWT_SECRET) {
        return process.env.JWT_SECRET;
    }
    console.warn('[Security Warning] JWT_SECRET is not set in environment variables. Using an ephemeral random secret key (not scalable horizontally).');
    if (!global.ephemeralJwtSecret) {
        global.ephemeralJwtSecret = crypto_1.default.randomBytes(32).toString('hex');
    }
    return global.ephemeralJwtSecret;
}
function authenticateJWT(req, res, next) {
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
        const decoded = jsonwebtoken_1.default.verify(token, secret, { algorithms: ['HS256'] });
        req.user = {
            memberId: decoded.memberId,
            whatsappNumber: decoded.whatsappNumber
        };
        next();
    }
    catch (err) {
        res.status(403).json({ error: 'Invalid or expired token' });
    }
}
