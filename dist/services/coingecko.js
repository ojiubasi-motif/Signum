"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrUpdateCoinList = getOrUpdateCoinList;
exports.resolveCoingeckoId = resolveCoingeckoId;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const secureFetch_1 = require("../utils/secureFetch");
const COINLIST_PATH = path.join(__dirname, '../db/coinlist.json');
/**
 * Loads the cached CoinGecko coin list or fetches a fresh one from CoinGecko
 * if the cache is older than 7 days (or missing).
 */
async function getOrUpdateCoinList() {
    // Check if we are in test mode
    const isTest = process.env.NODE_ENV === 'test';
    if (isTest) {
        // Return a basic mock coin list for tests to ensure controlled test execution
        return [
            { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
            { id: 'ethereum', symbol: 'eth', name: 'Ethereum' },
            { id: 'c-chain', symbol: 'c', name: 'C-Chain' },
            { id: 'other-c-token', symbol: 'c', name: 'Other C Token' }
        ];
    }
    const apiKey = process.env.COINGECKO_API_KEY || '';
    const isDemo = apiKey.startsWith('CG-');
    const baseUrl = isDemo || !apiKey
        ? 'https://api.coingecko.com/api/v3'
        : 'https://pro-api.coingecko.com/api/v3';
    const headerName = isDemo ? 'x-cg-demo-api-key' : 'x-cg-pro-api-key';
    // Check if cache file exists and is less than 7 days old
    if (fs.existsSync(COINLIST_PATH)) {
        try {
            const stats = fs.statSync(COINLIST_PATH);
            const ageInDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
            if (ageInDays < 7) {
                const data = fs.readFileSync(COINLIST_PATH, 'utf8');
                return JSON.parse(data);
            }
        }
        catch (err) {
            console.error('⚠️ CoinGecko: Failed to read cached coin list:', err.message);
        }
    }
    // Fetch a fresh list from CoinGecko
    console.log('🔄 CoinGecko: Fetching fresh coin list from API...');
    const headers = {};
    if (apiKey) {
        headers[headerName] = apiKey;
    }
    try {
        const response = await (0, secureFetch_1.secureFetch)(`${baseUrl}/coins/list?include_platform=true`, { headers });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const list = (await response.json());
        if (Array.isArray(list) && list.length > 0) {
            // Create parent directory if needed
            const dir = path.dirname(COINLIST_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(COINLIST_PATH, JSON.stringify(list, null, 2), 'utf8');
            console.log(`✅ CoinGecko: Successfully updated coin list cache at ${COINLIST_PATH} (${list.length} coins)`);
            return list;
        }
    }
    catch (error) {
        console.error('❌ CoinGecko: Failed to update coin list from API:', error.message);
        // Fallback to existing cache if available
        if (fs.existsSync(COINLIST_PATH)) {
            try {
                const data = fs.readFileSync(COINLIST_PATH, 'utf8');
                return JSON.parse(data);
            }
            catch (e) { }
        }
    }
    return [];
}
/**
 * Resolves the CoinGecko ID for a token symbol by finding all matches in the coin list,
 * querying their prices, and identifying the one within the entry price range.
 *
 * @param symbol The asset symbol (e.g. "C")
 * @param entryMin The minimum entry price limit
 * @param entryMax The maximum entry price limit
 */
async function resolveCoingeckoId(symbol, entryMin, entryMax) {
    const cleanSymbol = symbol.trim().toLowerCase();
    // SSRF and Input Sanitization: Validate symbol matches character set rules
    if (!/^[a-z0-9_\-]+$/.test(cleanSymbol)) {
        console.warn(`⚠️ CoinGecko: Invalid symbol parameter rejected: "${cleanSymbol}"`);
        return null;
    }
    try {
        const list = await getOrUpdateCoinList();
        if (!list || list.length === 0) {
            console.warn('⚠️ CoinGecko: Coin list is empty, unable to resolve dynamically');
            return null;
        }
        // Find all matching symbols in coin list
        const candidates = list.filter(c => c.symbol.toLowerCase() === cleanSymbol);
        if (candidates.length === 0) {
            console.warn(`⚠️ CoinGecko: No coin with symbol "${symbol}" found in coin list`);
            return null;
        }
        // verify by current price (even if candidates.length === 1, as per guidelines)
        console.log(`🔍 CoinGecko: Resolving symbol "${symbol}" among ${candidates.length} candidates by price...`);
        const apiKey = process.env.COINGECKO_API_KEY || '';
        const isDemo = apiKey.startsWith('CG-');
        const baseUrl = isDemo || !apiKey
            ? 'https://api.coingecko.com/api/v3'
            : 'https://pro-api.coingecko.com/api/v3';
        const headerName = isDemo ? 'x-cg-demo-api-key' : 'x-cg-pro-api-key';
        const headers = {};
        if (apiKey) {
            headers[headerName] = apiKey;
        }
        // Query simple price for candidates (batch query up to 50 at a time to stay safe)
        const candidateIds = candidates.map(c => c.id);
        const idChunks = [];
        for (let i = 0; i < candidateIds.length; i += 50) {
            idChunks.push(candidateIds.slice(i, i + 50));
        }
        const prices = {};
        for (const chunk of idChunks) {
            // Validate IDs in chunk match regex pattern to prevent injection attacks
            const cleanChunk = chunk.filter(id => /^[a-z0-9_\-]+$/.test(id));
            if (cleanChunk.length === 0)
                continue;
            const url = `${baseUrl}/simple/price?ids=${cleanChunk.join(',')}&vs_currencies=usd`;
            const response = await (0, secureFetch_1.secureFetch)(url, { headers });
            if (response.ok) {
                const data = (await response.json());
                for (const id of cleanChunk) {
                    if (data[id] && typeof data[id].usd === 'number') {
                        prices[id] = data[id].usd;
                    }
                }
            }
        }
        // Find candidate whose price is within entryMin and entryMax
        let matchedId = null;
        for (const candidate of candidates) {
            const price = prices[candidate.id];
            if (price !== undefined && price >= entryMin && price <= entryMax) {
                console.log(`🎯 CoinGecko: Resolved symbol "${symbol}" -> ID "${candidate.id}" (Price $${price} is in range $${entryMin}-$${entryMax})`);
                matchedId = candidate.id;
                break;
            }
        }
        return matchedId;
    }
    catch (error) {
        console.error(`❌ CoinGecko: Error resolving ID for "${symbol}":`, error.message);
        return null;
    }
}
