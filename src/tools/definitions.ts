export const tools: any[] = [
  {
    name: 'get_live_price',
    description: 'Get the current live market price for a crypto asset against USDT from Binance',
    input_schema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'The crypto token symbol, e.g. ETH, BTC, SOL' }
      },
      required: ['asset']
    }
  },
  {
    name: 'save_signal',
    description: 'Save a fully parsed, calculated, and enriched signal to the database',
    input_schema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'e.g. BTC, ETH, SOL' },
        direction: { type: 'string', enum: ['BUY', 'SELL'] },
        entryMin: { type: 'number', description: 'The minimum entry zone price limit' },
        entryMax: { type: 'number', description: 'The maximum entry zone price limit' },
        tpPercent: { type: 'number', description: 'The take profit target percentage' },
        slPercent: { type: 'number', description: 'The stop loss target percentage' },
        tpPrice: { type: 'number', description: 'The calculated take profit target price' },
        slPrice: { type: 'number', description: 'The calculated stop loss target price' },
        rrRatio: { type: 'number', description: 'The calculated risk-reward ratio' },
        urgencyScore: { type: 'number', minimum: 1, maximum: 10, description: 'The urgency score between 1 and 10 based on distance to entry zone' },
        adminId: { type: 'string', description: 'The admin sender phone number or LID JID' },
        rawText: { type: 'string', description: 'The original raw message text' },
        messageId: { type: 'string', description: 'The unique WhatsApp message ID associated with this signal' }
      },
      required: [
        'asset', 'direction', 'entryMin', 'entryMax',
        'tpPercent', 'slPercent', 'tpPrice',
        'slPrice', 'rrRatio', 'adminId', 'rawText'
      ]
    }
  },
  {
    name: 'notify_members',
    description: 'Send push notification containing signal alerts to all subscribed members',
    input_schema: {
      type: 'object',
      properties: {
        signalId: { type: 'string', description: 'The unique database ID of the signal' },
        urgencyScore: { type: 'number', description: 'The calculated urgency score' },
        message: { type: 'string', description: 'Human friendly notification alert text' }
      },
      required: ['signalId', 'urgencyScore', 'message']
    }
  },
  {
    name: 'update_signal_status',
    description: 'Update the status of an existing signal in the database',
    input_schema: {
      type: 'object',
      properties: {
        signalId: { type: 'string', description: 'The unique database ID of the signal' },
        status: {
          type: 'string',
          enum: ['ENTRY_OPEN', 'ENTRY_MISSED', 'TP_HIT', 'SL_HIT', 'EXPIRED']
        }
      },
      required: ['signalId', 'status']
    }
  },
  {
    name: 'adjust_signal',
    description: 'Adjust or update the trading parameters (entry zone, TP, SL, or R:R) of an existing active signal in the database',
    input_schema: {
      type: 'object',
      properties: {
        signalId: { type: 'string', description: 'The unique database ID of the signal to adjust' },
        entryMin: { type: 'number', description: 'The adjusted minimum entry price limit' },
        entryMax: { type: 'number', description: 'The adjusted maximum entry price limit' },
        tpPercent: { type: 'number', description: 'The adjusted take profit target percentage' },
        slPercent: { type: 'number', description: 'The adjusted stop loss target percentage' },
        tpPrice: { type: 'number', description: 'The adjusted take profit target price' },
        slPrice: { type: 'number', description: 'The adjusted stop loss target price' },
        rrRatio: { type: 'number', description: 'The adjusted risk-reward ratio' },
        rawText: { type: 'string', description: 'The raw update/adjustment text from the admin' }
      },
      required: ['signalId']
    }
  },
  {
    name: 'flag_for_review',
    description: 'Flag a parsed signal for human review when the agent\'s parsing confidence is below 80%. Saves the signal as PENDING and DMs the admin for manual approval instead of activating it immediately. Use this instead of save_signal when you are uncertain about the parsed values.',
    input_schema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'e.g. BTC, ETH, SOL' },
        direction: { type: 'string', enum: ['BUY', 'SELL'] },
        entryMin: { type: 'number', description: 'Best-guess minimum entry zone price' },
        entryMax: { type: 'number', description: 'Best-guess maximum entry zone price' },
        tpPercent: { type: 'number', description: 'Best-guess take profit percentage' },
        slPercent: { type: 'number', description: 'Best-guess stop loss percentage' },
        tpPrice: { type: 'number', description: 'Best-guess take profit price' },
        slPrice: { type: 'number', description: 'Best-guess stop loss price' },
        rrRatio: { type: 'number', description: 'Best-guess risk-reward ratio' },
        urgencyScore: { type: 'number', minimum: 1, maximum: 10, description: 'Urgency score' },
        adminId: { type: 'string', description: 'The admin sender phone number or LID JID' },
        rawText: { type: 'string', description: 'The original raw message text' },
        confidence: { type: 'number', minimum: 0, maximum: 100, description: 'Your confidence percentage in the parsed values (0-100)' },
        reason: { type: 'string', description: 'Brief explanation of what is ambiguous or uncertain' },
        messageId: { type: 'string', description: 'The unique WhatsApp message ID associated with this signal' }
      },
      required: [
        'asset', 'direction', 'entryMin', 'entryMax',
        'tpPercent', 'slPercent', 'tpPrice',
        'slPrice', 'rrRatio', 'adminId', 'rawText',
        'confidence', 'reason'
      ]
    }
  }
];
