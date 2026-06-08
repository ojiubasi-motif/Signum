import Groq from 'groq-sdk';
import { tools as anthropicTools } from '../tools/definitions';
import { executeTool } from '../tools/executor';

let clientInstance: Groq | null = null;

function getGroqClient(): Groq {
  if (!clientInstance) {
    clientInstance = new Groq({
      apiKey: process.env.GROQ_API_KEY || '',
    });
  }
  return clientInstance;
}

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const AGENT_SYSTEM_PROMPT = `
You are Signum, an autonomous AI agent that processes crypto trading signals from WhatsApp.

Your job for every message:
1. Determine if the message is a trading signal, signal update, signal cancellation, or noise.
2. If it's a signal — extract all trading data precisely (asset, direction, entryMin, entryMax, tpPercent, slPercent).
3. Get the live price for the asset using the \`get_live_price\` tool.
4. Calculate and output the TP price, SL price, and Risk-Reward (R:R) ratio using the following exact formulas:
   - For BUY signals:
     * tpPrice = entryMax * (1 + tpPercent / 100)
     * slPrice = entryMin * (1 - slPercent / 100)
   - For SELL signals:
     * tpPrice = entryMin * (1 - tpPercent / 100)
     * slPrice = entryMax * (1 + slPercent / 100)
   - Risk-Reward Ratio:
     * rrRatio = tpPercent / slPercent (rounded to 2 decimal places)
5. Assess the urgencyScore (integer between 1 and 10) based on how close the live price is to the entry zone:
   - If the live price is inside the entry zone [entryMin, entryMax], urgencyScore = 10.
   - If the live price has moved past the entry zone in the direction of the trade, urgencyScore = 1.
   - Otherwise, calculate proximity (urgencyScore = Math.max(1, Math.min(9, 10 - Math.round(Math.abs(livePrice - entryMin) / entryMin * 100)))).
6. Save the signal to the database using the \`save_signal\` tool. You MUST calculate and include all required parameters: 'asset', 'direction', 'entryMin', 'entryMax', 'tpPercent', 'slPercent', 'tpPrice', 'slPrice', 'rrRatio', 'urgencyScore', 'adminId', 'rawText'.
7. Notify members with a clear, human-friendly alert using the \`notify_members\` tool.

If confidence in parsing is below 80%, flag for human review. Never guess. Never fabricate price levels.
Think step-by-step before calling each tool to complete your task.
`;

export interface AgentContext {
  adminName: string;
  adminWinRate: number;
  openSignals: any[];
}

// Map Anthropic tools format dynamically to Groq/OpenAI compatible schema
const groqTools = anthropicTools.map(t => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

/**
 * Runs the autonomous Groq-based signal agent loop on a new incoming WhatsApp message.
 * @param messageText The text content of the message
 * @param adminId The sender ID (JID) of the admin
 * @param context Context about the admin's performance and active signals
 */
export async function runSignalAgent(
  messageText: string,
  adminId: string,
  context: AgentContext
): Promise<void> {
  console.log(`🤖 Invoking Signum Groq Agent for admin [${context.adminName}] with message: "${messageText.replace(/\n/g, ' ')}"`);

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `
        New message from Admin (Name: ${context.adminName}, ID: ${adminId}):
        "${messageText}"

        Current open signals: ${JSON.stringify(context.openSignals)}
        Admin win rate: ${context.adminWinRate}%
      `,
    },
  ];

  // Agentic loop — runs until agent stops requesting tool usage
  while (true) {
    const response = await getGroqClient().chat.completions.create({
      model: MODEL,
      messages: messages,
      tools: groqTools,
      tool_choice: 'auto',
      max_completion_tokens: 1024,
    });

    const choice = response.choices[0];
    const message = choice.message;

    // Track assistant's response (with tool_calls if any)
    messages.push(message);

    console.log(`🤖 Groq response finish reason: [${choice.finish_reason}]`);

    // Agent has finished or returns final conversational response
    if (choice.finish_reason === 'stop' || !message.tool_calls || message.tool_calls.length === 0) {
      if (message.content) {
        console.log(`💬 Conversational response: "${message.content}"`);
      }
      break;
    }

    // Agent requests tool executions
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const name = toolCall.function.name;
        
        let input: any;
        try {
          input = JSON.parse(toolCall.function.arguments);
        } catch (e: any) {
          console.error(`❌ Failed to parse arguments for tool [${name}]:`, toolCall.function.arguments);
          continue;
        }

        try {
          const result = await executeTool(name, input);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        } catch (error: any) {
          console.error(`❌ Tool execution failed for [${name}]:`, error.message);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: error.message }),
          });
        }
      }
    } else {
      break;
    }
  }

  console.log(`🤖 Signum Groq Agent run completed`);
}
