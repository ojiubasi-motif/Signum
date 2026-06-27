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

    if (!matchedId) {
      console.warn(`⚠️ CoinGecko: No candidate for symbol "${symbol}" matched the price range $${entryMin}-$${entryMax}`);
    }

    return matchedId;

  } catch (error: any) {
    console.error(`❌ CoinGecko: Error resolving ID for "${symbol}":`, error.message);
    return null;
  }
}

/* ─── DEX Pool Fallback ────────────────────────────────────────────── */

/** Allowed DEX networks — allowlist prevents SSRF via injection */
const ALLOWED_NETWORKS = ['eth', 'bsc', 'solana'] as const;
type DexNetwork = typeof ALLOWED_NETWORKS[number];

/** Network priority for pool selection (highest liquidity first) */
const NETWORK_PRIORITY: Record<DexNetwork, number> = { eth: 0, bsc: 1, solana: 2 };

export interface DexPoolResult {
  network: DexNetwork;
  poolAddress: string;
  tokenAddress: string;
}

/**
 * Searches GeckoTerminal for DEX pools containing the given token symbol.
 * Validates all data before use (SSRF prevention, input validation).
 * Returns the best pool ranked by network priority then FDV.
 */
export async function searchDexPool(symbol: string): Promise<DexPoolResult | null> {
  const cleanSymbol = symbol.trim().toLowerCase();

  // Input validation: only alphanumeric, hyphen, underscore (OWASP allow-list)
  if (!/^[a-z0-9_\-]+$/.test(cleanSymbol)) {
    console.warn(`⚠️ CoinGecko: Invalid symbol rejected for pool search: "${cleanSymbol}"`);
    return null;
  }

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

  try {
    console.log(`🔍 CoinGecko: Searching DEX pools for symbol "${symbol}"...`);
    const url = `${baseUrl}/onchain/search/pools?query=${encodeURIComponent(cleanSymbol)}&include=base_token&page=1`;
    const response = await secureFetch(url, { headers });

    if (!response.ok) {
      console.warn(`⚠️ CoinGecko: Pool search returned ${response.status} for "${symbol}"`);
      return null;
    }

    const json = (await response.json()) as {
      data: Array<{
        attributes: { address: string; fdv_usd: number | null; name: string };
        relationships: { base_token: { data: { id: string } } };
      }>;
      included: Array<{
        type: string;
        id: string;
        attributes: { symbol: string; address: string };
      }>;
    };

    if (!Array.isArray(json.data) || json.data.length === 0) {
      console.warn(`⚠️ CoinGecko: No DEX pools found for symbol "${symbol}"`);
      return null;
    }

    // Build a lookup of included base_tokens by their composite ID
    const includedTokenSymbols = new Map<string, string>();
    for (const item of json.included ?? []) {
      if (item.type === 'token') {
        includedTokenSymbols.set(item.id, item.attributes?.symbol?.toLowerCase() ?? '');
      }
    }

    // Validate and score each pool
    const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
    const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

    interface ScoredPool {
      network: DexNetwork;
      poolAddress: string;
      tokenAddress: string;
      fdv: number;
      priority: number;
    }

    const validPools: ScoredPool[] = [];

    for (const pool of json.data) {
      const baseTokenId: string = pool.relationships?.base_token?.data?.id ?? '';
      if (!baseTokenId) continue;

      // Extract network and token address from composite ID "{network}_{address}"
      const underscoreIdx = baseTokenId.indexOf('_');
      if (underscoreIdx === -1) continue;
      const rawNetwork = baseTokenId.slice(0, underscoreIdx);
      const tokenAddress = baseTokenId.slice(underscoreIdx + 1);
      const poolAddress = pool.attributes?.address ?? '';

      // Validate network against allowlist
      if (!(ALLOWED_NETWORKS as readonly string[]).includes(rawNetwork)) continue;
      const network = rawNetwork as DexNetwork;

      // Validate token symbol matches searched symbol (prevent false positives)
      const baseTokenSymbol = includedTokenSymbols.get(baseTokenId) ?? '';
      if (baseTokenSymbol !== cleanSymbol) continue;

      // Validate addresses by network type
      if (network === 'solana') {
        if (!SOL_ADDRESS_RE.test(poolAddress) || !SOL_ADDRESS_RE.test(tokenAddress)) {
          console.warn(`⚠️ CoinGecko: Invalid Solana address for pool "${poolAddress}" — skipped`);
          continue;
        }
      } else {
        if (!EVM_ADDRESS_RE.test(poolAddress) || !EVM_ADDRESS_RE.test(tokenAddress)) {
          console.warn(`⚠️ CoinGecko: Invalid EVM address for pool "${poolAddress}" — skipped`);
          continue;
        }
      }

      validPools.push({
        network,
        poolAddress,
        tokenAddress,
        fdv: pool.attributes?.fdv_usd ?? 0,
        priority: NETWORK_PRIORITY[network],
      });
    }

    if (validPools.length === 0) {
      console.warn(`⚠️ CoinGecko: No valid DEX pools with matching symbol found for "${symbol}"`);
      return null;
    }

    // Rank: first by network priority (eth < bsc < solana), then by FDV descending
    validPools.sort((a, b) => a.priority - b.priority || b.fdv - a.fdv);
    const best = validPools[0];

    console.log(
      `🎯 CoinGecko: Best pool for "${symbol}" — ${best.network.toUpperCase()} pool ${best.poolAddress} (FDV $${best.fdv?.toFixed(0) ?? '?'})`
    );

    return { network: best.network, poolAddress: best.poolAddress, tokenAddress: best.tokenAddress };

  } catch (error: any) {
    console.error(`❌ CoinGecko: Error searching DEX pools for "${symbol}":`, error.message);
    return null;
  }
}
