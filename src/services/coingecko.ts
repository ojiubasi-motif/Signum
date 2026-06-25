import * as fs from 'fs';
import * as path from 'path';
import { secureFetch } from '../utils/secureFetch';

const COINLIST_PATH = path.join(__dirname, '../db/coinlist.json');

export interface CoinListEntry {
  id: string;
  symbol: string;
  name: string;
  platforms?: Record<string, string>;
}

/**
 * Loads the cached CoinGecko coin list or fetches a fresh one from CoinGecko
 * if the cache is older than 7 days (or missing).
 */
export async function getOrUpdateCoinList(): Promise<CoinListEntry[]> {
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
    } catch (err: any) {
      console.error('⚠️ CoinGecko: Failed to read cached coin list:', err.message);
    }
  }

  // Fetch a fresh list from CoinGecko
  console.log('🔄 CoinGecko: Fetching fresh coin list from API...');
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers[headerName] = apiKey;
  }

  try {
    const response = await secureFetch(`${baseUrl}/coins/list?include_platform=true`, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const list = (await response.json()) as CoinListEntry[];
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
  } catch (error: any) {
    console.error('❌ CoinGecko: Failed to update coin list from API:', error.message);
    // Fallback to existing cache if available
    if (fs.existsSync(COINLIST_PATH)) {
      try {
        const data = fs.readFileSync(COINLIST_PATH, 'utf8');
        return JSON.parse(data);
      } catch (e) {}
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
export async function resolveCoingeckoId(
  symbol: string,
  entryMin: number,
  entryMax: number
): Promise<string | null> {
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
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers[headerName] = apiKey;
    }

    // Query simple price for candidates (batch query up to 50 at a time to stay safe)
    const candidateIds = candidates.map(c => c.id);
    const idChunks: string[][] = [];
    for (let i = 0; i < candidateIds.length; i += 50) {
      idChunks.push(candidateIds.slice(i, i + 50));
    }

    const prices: Record<string, number> = {};

    for (const chunk of idChunks) {
      // Validate IDs in chunk match regex pattern to prevent injection attacks
      const cleanChunk = chunk.filter(id => /^[a-z0-9_\-]+$/.test(id));
      if (cleanChunk.length === 0) continue;

      const url = `${baseUrl}/simple/price?ids=${cleanChunk.join(',')}&vs_currencies=usd`;
      const response = await secureFetch(url, { headers });
      if (response.ok) {
        const data = (await response.json()) as any;
        for (const id of cleanChunk) {
          if (data[id] && typeof data[id].usd === 'number') {
            prices[id] = data[id].usd;
          }
        }
      }
    }

    // Find candidate whose price is within entryMin and entryMax
    let matchedId: string | null = null;
    for (const candidate of candidates) {
      const price = prices[candidate.id];
      if (price !== undefined && price >= entryMin && price <= entryMax) {
        console.log(`🎯 CoinGecko: Resolved symbol "${symbol}" -> ID "${candidate.id}" (Price $${price} is in range $${entryMin}-$${entryMax})`);
        matchedId = candidate.id;
        break;
      }
    }

    return matchedId;

  } catch (error: any) {
    console.error(`❌ CoinGecko: Error resolving ID for "${symbol}":`, error.message);
    return null;
  }
}
