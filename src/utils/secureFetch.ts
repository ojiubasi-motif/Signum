import { URL } from 'url';

const ALLOWED_DOMAINS = [
  'api.coingecko.com',
  'pro-api.coingecko.com',
  'api.binance.com',
  'api.groq.com',
  'api.cerebras.ai',
  'generativelanguage.googleapis.com',
  'openrouter.ai'
];

/**
 * A secure fetch wrapper that implements SSRF mitigation checks:
 * 1. Restricts protocols to HTTP/HTTPS.
 * 2. Enforces an allowed domain list.
 * 3. Blocks downstream HTTP redirect-following by setting redirect: 'error'.
 */
export async function secureFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const parsedUrl = new URL(url);

  // 1. Strict Protocol Restricting
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`SSRF Prevention: Unsupported protocol: ${parsedUrl.protocol}`);
  }

  // 2. Outbound Destination Allowlisting
  if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
    throw new Error(`SSRF Prevention: Access denied for domain ${parsedUrl.hostname}`);
  }

  // 3. Block Downstream HTTP Redirect-Following
  const mergedOptions: RequestInit = {
    ...options,
    redirect: 'error',
  };

  return fetch(url, mergedOptions);
}
