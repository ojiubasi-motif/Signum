import * as dotenv from 'dotenv';
dotenv.config({ override: true });

process.env.NODE_ENV = 'test';

import { callAIWithFallback } from '../src/agent/providers';

// Backup the original fetch
const originalFetch = global.fetch;

async function testFallbackChain() {
  console.log('🧪 Starting Agent Fallback Chain Tests...');

  const callsTracked: string[] = [];

  // Override global fetch
  global.fetch = (async (url: any, options: any) => {
    const urlStr = url.toString();
    console.log(`📡 Mocked fetch intercepted request to: ${urlStr}`);
    
    let providerName = '';
    if (urlStr.includes('api.groq.com')) providerName = 'groq';
    else if (urlStr.includes('api.cerebras.ai')) providerName = 'cerebras';
    else if (urlStr.includes('generativelanguage.googleapis.com')) providerName = 'gemini';
    else if (urlStr.includes('openrouter.ai')) providerName = 'openrouter';

    callsTracked.push(providerName);

    if (providerName === 'groq') {
      console.log('   -> Simulating HTTP 429 Rate Limit for Groq');
      return {
        status: 429,
        ok: false,
        text: async () => 'Rate limit exceeded'
      } as Response;
    }

    if (providerName === 'cerebras') {
      console.log('   -> Simulating HTTP 503 Service Unavailable for Cerebras');
      return {
        status: 503,
        ok: false,
        text: async () => 'Service Unavailable'
      } as Response;
    }

    if (providerName === 'gemini') {
      console.log('   -> Simulating HTTP 200 Success for Gemini');
      return {
        status: 200,
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'Hello from fallback provider Gemini!'
              }
            }
          ]
        })
      } as Response;
    }

    return {
      status: 500,
      ok: false,
      text: async () => 'Internal Server Error'
    } as Response;
  }) as any;

  try {
    const response = await callAIWithFallback([
      { role: 'user', content: 'Say hello' }
    ]);

    console.log('✅ Fallback response received:', JSON.stringify(response));

    // Assertions
    const content = response.choices[0].message.content;
    if (content !== 'Hello from fallback provider Gemini!') {
      throw new Error(`Expected content from Gemini, got: ${content}`);
    }

    console.log('📊 Provider call sequence:', callsTracked);
    if (callsTracked.join('->') !== 'groq->cerebras->gemini') {
      throw new Error(`Unexpected sequence: ${callsTracked.join('->')}`);
    }

    // Now test that Groq is skipped in the next run because it was exhausted
    console.log('\n🔄 Run 2: Verifying Groq is skipped (marked exhausted)...');
    const secondCallsTracked: string[] = [];
    
    // Temporary override to track the second call sequence
    global.fetch = (async (url: any, options: any) => {
      const urlStr = url.toString();
      let providerName = '';
      if (urlStr.includes('api.groq.com')) providerName = 'groq';
      else if (urlStr.includes('api.cerebras.ai')) providerName = 'cerebras';
      else if (urlStr.includes('generativelanguage.googleapis.com')) providerName = 'gemini';
      
      secondCallsTracked.push(providerName);
      
      if (providerName === 'cerebras') {
        return {
          status: 503,
          ok: false,
          text: async () => 'Service Unavailable'
        } as Response;
      }
      if (providerName === 'gemini') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello 2' } }]
          })
        } as Response;
      }
      return { status: 500, ok: false } as Response;
    }) as any;

    await callAIWithFallback([{ role: 'user', content: 'Say hello again' }]);
    console.log('📊 Provider call sequence (Run 2):', secondCallsTracked);
    if (secondCallsTracked.includes('groq')) {
      throw new Error('Groq should have been skipped in second run!');
    }
    if (!secondCallsTracked.includes('cerebras') || !secondCallsTracked.includes('gemini')) {
      throw new Error('Should have tried Cerebras and then Gemini!');
    }

    console.log('🎉 ALL FALLBACK CHAIN UNIT TESTS PASSED!');
    process.exit(0);

  } catch (error: any) {
    console.error('❌ Fallback chain test failed:', error.message);
    process.exit(1);
  } finally {
    global.fetch = originalFetch;
  }
}

testFallbackChain();
