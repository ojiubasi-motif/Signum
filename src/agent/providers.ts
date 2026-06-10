import { tools as anthropicTools } from '../tools/definitions';

export interface AIProvider {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  isOpenRouter?: boolean;
  extraHeaders?: Record<string, string>;
  fallbackModels?: string[];
}

export const providers: AIProvider[] = [
  {
    name: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    get apiKey() { return process.env.GROQ_API_KEY || ''; },
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  },
  {
    name: 'cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    get apiKey() { return process.env.CEREBRAS_API_KEY || ''; },
    model: 'gpt-oss-120b'
  },
  {
    name: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    get apiKey() { return process.env.GEMINI_API_KEY || ''; },
    model: 'gemini-2.0-flash'
  },
  {
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    get apiKey() { return process.env.OPENROUTER_API_KEY || ''; },
    model: 'meta-llama/llama-3.3-70b-instruct',
    isOpenRouter: true,
    extraHeaders: {
      'HTTP-Referer': 'https://your-signal-app.com',
      'X-Title': 'TradeRelay'
    },
    fallbackModels: [
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.0-flash-001',
      'mistralai/mistral-small',
    ]
  }
];

const exhausted = new Set<string>();

// Reset exhausted providers every hour
setInterval(() => {
  exhausted.clear();
  console.log('[AI] Provider limits reset');
}, 60 * 60 * 1000);

/**
 * Standard fetch helper with timeout fallback.
 */
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timeout of ${timeoutMs}ms exceeded`));
    }, timeoutMs);

    fetch(url, { ...options, signal: controller.signal })
      .then(res => {
        clearTimeout(timeout);
        resolve(res);
      })
      .catch(err => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

/**
 * Calls the active AI provider chat completion endpoint, falling back to the next
 * available provider if errors, timeouts, or rate limits occur.
 * 
 * @param messages The standard chat completion message history
 * @param tools Optional tools for tool calling
 */
export async function callAIWithFallback(messages: any[], tools?: any[]): Promise<any> {
  for (const provider of providers) {
    if (!provider.apiKey) {
      console.log(`[AI] Skipping ${provider.name} — API key is missing`);
      continue;
    }

    if (exhausted.has(provider.name)) {
      console.log(`[AI] Skipping ${provider.name} — already exhausted`);
      continue;
    }

    try {
      console.log(`[AI] Trying ${provider.name}...`);

      const body: Record<string, any> = {
        model: provider.model,
        messages: messages,
        max_tokens: 1024,
      };

      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      if (provider.isOpenRouter) {
        body.models = provider.fallbackModels;
        body.route = 'fallback';
        body.provider = {
          sort: 'throughput',
          allow_fallbacks: true
        };
      }

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
        ...(provider.extraHeaders || {})
      };

      const response = await fetchWithTimeout(`${provider.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, 15000);

      // Handle HTTP status codes
      if (response.status === 429) {
        console.warn(`[AI] ${provider.name} rate limited (429) — marking exhausted`);
        exhausted.add(provider.name);
        continue;
      }

      if (response.status === 503 || response.status === 502) {
        console.warn(`[AI] ${provider.name} unavailable (${response.status}) — trying next`);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`${provider.name} returned status ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      if (!choice) {
        throw new Error(`Invalid response structure from ${provider.name}: no choices found`);
      }

      const modelUsed = provider.isOpenRouter ? (data.model || provider.model) : provider.model;
      console.log(`[AI] Served by ${provider.name} (${modelUsed})`);

      // Return standardized OpenAI response block
      return {
        choices: [
          {
            finish_reason: choice.finish_reason || 'stop',
            message: {
              role: 'assistant',
              content: choice.message?.content || null,
              tool_calls: choice.message?.tool_calls || null
            }
          }
        ]
      };

    } catch (error: any) {
      console.error(`[AI] ${provider.name} failed with error:`, error.message || error);
      continue;
    }
  }

  throw new Error('[AI] All providers failed — no completion generated');
}
