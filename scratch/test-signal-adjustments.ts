import * as dotenv from 'dotenv';
dotenv.config({ override: true });

process.env.NODE_ENV = 'test';

import Groq from 'groq-sdk';

// ── LOCAL MOCK LAYER FOR GROQ ──
Groq.Chat.Completions.prototype.create = async function (params: any) {
  const userMsg = params.messages.find((m: any) => m.role === 'user')?.content || '';
  const match = userMsg.match(/New message from Admin.*?:\s*"([\s\S]*?)"/i);
  const adminMsg = match ? match[1].trim() : userMsg.trim();
  
  if (adminMsg.includes('BUY BTC at 63774-63775')) {
    const hasLivePriceToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('price'));
    const hasSaveSignalToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('signalId'));
    
    if (!hasLivePriceToolResult) {
      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_price_123',
              type: 'function',
              function: {
                name: 'get_live_price',
                arguments: JSON.stringify({ asset: 'BTC' })
              }
            }]
          }
        }]
      } as any;
    } else if (!hasSaveSignalToolResult) {
      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_save_123',
                type: 'function',
                function: {
                  name: 'save_signal',
                  arguments: JSON.stringify({
                    adminId: 'proof_admin@s.whatsapp.net',
                    asset: 'BTC',
                    direction: 'BUY',
                    entryMin: 63774,
                    entryMax: 63775,
                    tpPercent: 0.08,
                    slPercent: 0.14,
                    tpPrice: 63780,
                    slPrice: 63765,
                    rrRatio: 0.57,
                    urgencyScore: 10,
                    rawText: 'BUY BTC at 63774-63775, Target: 63780, Stoploss: 63765'
                  })
                }
              },
              {
                id: 'call_notify_123',
                type: 'function',
                function: {
                  name: 'notify_members',
                  arguments: JSON.stringify({
                    signalId: 'mock-signal-id',
                    urgencyScore: 10,
                    message: 'New signal: BUY BTC at 63774-63775'
                  })
                }
              }
            ]
          }
        }]
      } as any;
    } else {
      return {
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Successfully parsed and saved the BUY BTC signal.'
          }
        }]
      } as any;
    }
  }

  if (adminMsg === 'take stoploss to max entry' || adminMsg === 'take BTC stoploss to max entry') {
    const hasAdjustToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('adjusted'));
    if (!hasAdjustToolResult) {
      const matches = userMsg.match(/Current open signals: (\[.*\])/);
      const openSignals = matches ? JSON.parse(matches[1]) : [];
      const sorted = openSignals.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const signalId = sorted[0]?.id || 'mock-id';

      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_adjust_123',
                type: 'function',
                function: {
                  name: 'adjust_signal',
                  arguments: JSON.stringify({
                    signalId,
                    slPrice: 63775,
                    slPercent: 0,
                    rawText: adminMsg
                  })
                }
              },
              {
                id: 'call_notify_adjust_123',
                type: 'function',
                function: {
                  name: 'notify_members',
                  arguments: JSON.stringify({
                    signalId,
                    urgencyScore: 10,
                    message: 'BTC Stoploss adjusted to max entry'
                  })
                }
              }
            ]
          }
        }]
      } as any;
    } else {
      return {
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Successfully adjusted stoploss to max entry.'
          }
        }]
      } as any;
    }
  }

  if (adminMsg === 'make BTC trade breakeven') {
    const hasAdjustToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('adjusted'));
    if (!hasAdjustToolResult) {
      const matches = userMsg.match(/Current open signals: (\[.*\])/);
      const openSignals = matches ? JSON.parse(matches[1]) : [];
      const signalId = openSignals[0]?.id || 'mock-id';

      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_adjust_456',
                type: 'function',
                function: {
                  name: 'adjust_signal',
                  arguments: JSON.stringify({
                    signalId,
                    slPrice: 63775,
                    slPercent: 0,
                    rawText: 'make BTC trade breakeven'
                  })
                }
              },
              {
                id: 'call_notify_adjust_456',
                type: 'function',
                function: {
                  name: 'notify_members',
                  arguments: JSON.stringify({
                    signalId,
                    urgencyScore: 10,
                    message: 'BTC Trade Breakeven'
                  })
                }
              }
            ]
          }
        }]
      } as any;
    } else {
      return {
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Successfully adjusted BTC to breakeven.'
          }
        }]
      } as any;
    }
  }

  if (adminMsg === 'leave BTC SL open') {
    const hasAdjustToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('adjusted'));
    if (!hasAdjustToolResult) {
      const matches = userMsg.match(/Current open signals: (\[.*\])/);
      const openSignals = matches ? JSON.parse(matches[1]) : [];
      const signalId = openSignals[0]?.id || 'mock-id';

      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_adjust_789',
                type: 'function',
                function: {
                  name: 'adjust_signal',
                  arguments: JSON.stringify({
                    signalId,
                    slPrice: 0,
                    slPercent: 0,
                    rawText: 'leave BTC SL open'
                  })
                }
              },
              {
                id: 'call_notify_adjust_789',
                type: 'function',
                function: {
                  name: 'notify_members',
                  arguments: JSON.stringify({
                    signalId,
                    urgencyScore: 10,
                    message: 'BTC SL left open'
                  })
                }
              }
            ]
          }
        }]
      } as any;
    } else {
      return {
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Successfully left BTC SL open.'
          }
        }]
      } as any;
    }
  }

  if (adminMsg === 'close BTC trade') {
    const hasUpdateStatusToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('updated'));
    if (!hasUpdateStatusToolResult) {
      const matches = userMsg.match(/Current open signals: (\[.*\])/);
      const openSignals = matches ? JSON.parse(matches[1]) : [];
      const signalId = openSignals.find((s: any) => s.asset === 'BTC')?.id || 'mock-id';

      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_close_123',
                type: 'function',
                function: {
                  name: 'update_signal_status',
                  arguments: JSON.stringify({
                    signalId,
                    status: 'EXPIRED'
                  })
                }
              },
              {
                id: 'call_notify_close_123',
                type: 'function',
                function: {
                  name: 'notify_members',
                  arguments: JSON.stringify({
                    signalId,
                    urgencyScore: 10,
                    message: 'BTC trade closed at current price.'
                  })
                }
              }
            ]
          }
        }]
      } as any;
    } else {
      return {
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Successfully closed BTC trade.'
          }
        }]
      } as any;
    }
  }

  if (adminMsg === 'switch BTC for BUY ETH at 1800-1820, Target: 1900, Stoploss: 1750') {
    const hasUpdateStatusToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('updated'));
    const hasLivePriceToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('price'));
    const hasSaveSignalToolResult = params.messages.some((m: any) => m.role === 'tool' && m.content.includes('signalId'));

    if (!hasUpdateStatusToolResult || !hasLivePriceToolResult) {
      const matches = userMsg.match(/Current open signals: (\[.*\])/);
      const openSignals = matches ? JSON.parse(matches[1]) : [];
      const signalId = openSignals.find((s: any) => s.asset === 'BTC')?.id || 'mock-id';

      const tool_calls = [];
      if (!hasUpdateStatusToolResult) {
        tool_calls.push({
          id: 'call_switch_close_123',
          type: 'function',
          function: {
            name: 'update_signal_status',
            arguments: JSON.stringify({
              signalId,
              status: 'EXPIRED'
            })
          }
        });
      }
      if (!hasLivePriceToolResult) {
        tool_calls.push({
          id: 'call_switch_price_123',
          type: 'function',
          function: {
            name: 'get_live_price',
            arguments: JSON.stringify({ asset: 'ETH' })
          }
        });
      }

      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls
          }
        }]
      } as any;
    } else if (!hasSaveSignalToolResult) {
      return {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_switch_save_123',
                type: 'function',
                function: {
                  name: 'save_signal',
                  arguments: JSON.stringify({
                    adminId: 'proof_admin@s.whatsapp.net',
                    asset: 'ETH',
                    direction: 'BUY',
                    entryMin: 1800,
                    entryMax: 1820,
                    tpPercent: 4.4,
                    slPercent: 3.89,
                    tpPrice: 1900,
                    slPrice: 1750,
                    rrRatio: 1.13,
                    urgencyScore: 10,
                    rawText: 'switch BTC for BUY ETH at 1800-1820, Target: 1900, Stoploss: 1750'
                  })
                }
              },
              {
                id: 'call_switch_notify_123',
                type: 'function',
                function: {
                  name: 'notify_members',
                  arguments: JSON.stringify({
                    signalId: 'mock-eth-signal-id',
                    urgencyScore: 10,
                    message: 'Switched BTC for ETH'
                  })
                }
              }
            ]
          }
        }]
      } as any;
    } else {
      return {
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Successfully switched BTC for ETH.'
          }
        }]
      } as any;
    }
  }

  return {
    choices: [{
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: 'Finished mock response'
      }
    }]
  } as any;
};

// ── DB & INTEGRATION TEST LOGIC ──
import { prisma } from '../src/db/src/index';
import { runSignalAgent } from '../src/agent';
import { setMockPrice } from '../src/services/binance';
import { formatWhatsappNumber } from '../src/utils/formatter';

const TEST_ADMIN_ID = 'proof_admin@s.whatsapp.net';
const TEST_MEMBER_ID = 'proof_member@s.whatsapp.net';

async function testAdjustmentsAndDeletes() {
  console.log('🧪 Starting conversational Signal Adjustments, Absolute Pricing, and Deletes Tests...');

  // Setup mock price for BTC and ETH
  setMockPrice('BTC', 63774.5);
  setMockPrice('ETH', 1810);

  // Ensure test admin & member exist
  const dbAdmin = await prisma.admin.upsert({
    where: { id: TEST_ADMIN_ID },
    create: { id: TEST_ADMIN_ID, name: 'ProofAdmin' },
    update: {},
  });

  const dbMember = await prisma.member.upsert({
    where: { whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID) },
    create: { whatsappNumber: formatWhatsappNumber(TEST_MEMBER_ID) },
    update: {},
  });

  // Delete any existing BTC/ETH signals/trades for clean run
  await prisma.memberTrade.deleteMany({ where: { memberId: dbMember.id } });
  await prisma.signal.deleteMany({
    where: {
      OR: [
        { adminId: TEST_ADMIN_ID },
        { messageId: 'msg-initial-btc-123' },
        { messageId: 'msg-switch-eth-123' }
      ]
    }
  });

  try {
    // ── STEP 1: Ingest Initial Absolute Price Signal ──
    const signalText = 'BUY BTC at 63774-63775, Target: 63780, Stoploss: 63765';
    const initialMsgId = 'msg-initial-btc-123';
    console.log(`\n💬 Phase 1: Ingesting initial signal: "${signalText}"`);
    
    await runSignalAgent(signalText, TEST_ADMIN_ID, {
      adminName: 'ProofAdmin',
      adminWinRate: 100,
      openSignals: [],
    }, initialMsgId);

    const savedSignal = await prisma.signal.findFirst({
      where: { adminId: TEST_ADMIN_ID, asset: 'BTC', status: 'ENTRY_OPEN' },
      orderBy: { createdAt: 'desc' },
    });

    if (!savedSignal || savedSignal.messageId !== initialMsgId) {
      throw new Error('❌ Initial Signal Ingestion Failed: BTC signal was not saved or messageId was missing.');
    }

    console.log('✅ Initial Signal Saved Successfully!');
    console.log(`  ├─ Signal ID: ${savedSignal.id}`);
    console.log(`  ├─ Message ID: ${savedSignal.messageId}`);
    console.log(`  ├─ Entry Zone: $${savedSignal.entryMin} - $${savedSignal.entryMax}`);
    console.log(`  ├─ TP Price: $${savedSignal.tpPrice} (${savedSignal.tpPercent.toFixed(4)}%)`);
    console.log(`  └─ SL Price: $${savedSignal.slPrice} (${savedSignal.slPercent.toFixed(4)}%)`);

    if (savedSignal.tpPrice !== 63780 || savedSignal.slPrice !== 63765) {
      throw new Error(`❌ TP/SL price mismatch. Got TP ${savedSignal.tpPrice}, SL ${savedSignal.slPrice}`);
    }

    // Link a trade to test foreign keys cascade during deletes
    await prisma.memberTrade.create({
      data: {
        memberId: dbMember.id,
        signalId: savedSignal.id,
      }
    });

    // ── STEP 2: Test "take BTC stoploss to max entry" ──
    const adjustMaxEntryText = 'take BTC stoploss to max entry';
    console.log(`\n💬 Phase 2: Ingesting adjustment text: "${adjustMaxEntryText}"`);

    await runSignalAgent(adjustMaxEntryText, TEST_ADMIN_ID, {
      adminName: 'ProofAdmin',
      adminWinRate: 100,
      openSignals: [savedSignal],
    });

    let adjustedSignal = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    if (!adjustedSignal) throw new Error('Signal lost');

    console.log('✅ Signal Adjusted to Max Entry Successfully!');
    console.log(`  ├─ Entry Max (Max Entry): $${adjustedSignal.entryMax}`);
    console.log(`  └─ New SL Price: $${adjustedSignal.slPrice} (New SL %: ${adjustedSignal.slPercent.toFixed(4)}%)`);

    // For BUY signal: max entry is entryMax (63775)
    if (adjustedSignal.slPrice !== adjustedSignal.entryMax) {
      throw new Error(`❌ Max entry SL adjustment failed: Expected SL ${adjustedSignal.entryMax}, Got ${adjustedSignal.slPrice}`);
    }

    // ── STEP 2.5: Test "take stoploss to max entry" (no BTC specified) ──
    // Reset SL back to 63765 first
    await prisma.signal.update({
      where: { id: savedSignal.id },
      data: { slPrice: 63765, slPercent: 5 }
    });

    const refreshedSignal2 = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    const adjustNoCoinText = 'take stoploss to max entry';
    console.log(`\n💬 Phase 2.5: Ingesting adjustment text without coin: "${adjustNoCoinText}"`);

    await runSignalAgent(adjustNoCoinText, TEST_ADMIN_ID, {
      adminName: 'ProofAdmin',
      adminWinRate: 100,
      openSignals: [refreshedSignal2],
    });

    adjustedSignal = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    if (!adjustedSignal) throw new Error('Signal lost');

    console.log('✅ Signal Adjusted to Max Entry (No Coin specified) Successfully!');
    console.log(`  └─ New SL Price: $${adjustedSignal.slPrice}`);

    if (adjustedSignal.slPrice !== adjustedSignal.entryMax) {
      throw new Error(`❌ Max entry SL adjustment (No Coin) failed: Expected SL ${adjustedSignal.entryMax}, Got ${adjustedSignal.slPrice}`);
    }

    // ── STEP 3: Test "make BTC trade breakeven" ──
    // Reset SL back to 63765 first
    await prisma.signal.update({
      where: { id: savedSignal.id },
      data: { slPrice: 63765, slPercent: 5 }
    });
    
    const refreshedSignal = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    const adjustBreakevenText = 'make BTC trade breakeven';
    console.log(`\n💬 Phase 3: Ingesting adjustment text: "${adjustBreakevenText}"`);

    await runSignalAgent(adjustBreakevenText, TEST_ADMIN_ID, {
      adminName: 'ProofAdmin',
      adminWinRate: 100,
      openSignals: [refreshedSignal],
    });

    adjustedSignal = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    if (!adjustedSignal) throw new Error('Signal lost');

    console.log('✅ Signal Adjusted to Breakeven Successfully!');
    console.log(`  └─ New SL Price: $${adjustedSignal.slPrice}`);

    if (adjustedSignal.slPrice !== adjustedSignal.entryMax) {
      throw new Error(`❌ Breakeven adjustment failed: Expected SL ${adjustedSignal.entryMax}, Got ${adjustedSignal.slPrice}`);
    }

    // ── STEP 4: Test "leave SL open" ──
    const adjustLeaveOpenText = 'leave BTC SL open';
    console.log(`\n💬 Phase 4: Ingesting adjustment text: "${adjustLeaveOpenText}"`);

    await runSignalAgent(adjustLeaveOpenText, TEST_ADMIN_ID, {
      adminName: 'ProofAdmin',
      adminWinRate: 100,
      openSignals: [adjustedSignal],
    });

    adjustedSignal = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    if (!adjustedSignal) throw new Error('Signal lost');

    console.log('✅ Signal Adjusted to Open SL Successfully!');
    console.log(`  └─ New SL Price: $${adjustedSignal.slPrice} (New SL %: ${adjustedSignal.slPercent}%)`);

    if (adjustedSignal.slPrice !== 0 || adjustedSignal.slPercent !== 0) {
      throw new Error(`❌ Open SL adjustment failed: Expected SL price and percent to be 0. Got price ${adjustedSignal.slPrice}, percent ${adjustedSignal.slPercent}`);
    }

    // ── STEP 4.5: Test "close BTC trade" ──
    // Reset BTC signal status back to ENTRY_OPEN and set SL back
    await prisma.signal.update({
      where: { id: savedSignal.id },
      data: { status: 'ENTRY_OPEN', slPrice: 63765, slPercent: 5 }
    });
    const updatedSignalForClose = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    
    console.log('\n💬 Phase 4.5: Ingesting close signal instruction: "close BTC trade"');
    await runSignalAgent('close BTC trade', TEST_ADMIN_ID, {
      adminName: 'ProofAdmin',
      adminWinRate: 100,
      openSignals: [updatedSignalForClose],
    });

    const closedSignal = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    if (!closedSignal) throw new Error('Signal lost');

    console.log('✅ Signal Closed (Expired) Successfully!');
    console.log(`  ├─ Signal ID: ${closedSignal.id}`);
    console.log(`  └─ Status: ${closedSignal.status}`);

    if (closedSignal.status !== 'EXPIRED') {
      throw new Error(`❌ Close trade failed: Expected status EXPIRED, Got ${closedSignal.status}`);
    }

    // ── STEP 4.6: Test "switch BTC for BUY ETH at 1800-1820..." ──
    // Re-open BTC signal
    await prisma.signal.update({
      where: { id: savedSignal.id },
      data: { status: 'ENTRY_OPEN' }
    });
    const btcSignalForSwitch = await prisma.signal.findUnique({ where: { id: savedSignal.id } });

    console.log('\n💬 Phase 4.6: Ingesting switch signal instruction: "switch BTC for BUY ETH at 1800-1820, Target: 1900, Stoploss: 1750"');
    const switchMsgId = 'msg-switch-eth-123';
    await runSignalAgent('switch BTC for BUY ETH at 1800-1820, Target: 1900, Stoploss: 1750', TEST_ADMIN_ID, {
      adminName: 'ProofAdmin',
      adminWinRate: 100,
      openSignals: [btcSignalForSwitch],
    }, switchMsgId);

    const btcAfterSwitch = await prisma.signal.findUnique({ where: { id: savedSignal.id } });
    const ethSignal = await prisma.signal.findFirst({
      where: { adminId: TEST_ADMIN_ID, asset: 'ETH' }
    });

    if (!btcAfterSwitch || btcAfterSwitch.status !== 'EXPIRED') {
      throw new Error(`❌ Switch failed: BTC was not set to EXPIRED. Status: ${btcAfterSwitch?.status}`);
    }
    if (!ethSignal) {
      throw new Error('❌ Switch failed: ETH signal was not saved to DB.');
    }

    console.log('✅ Switched BTC for ETH Successfully!');
    console.log(`  ├─ BTC Status: ${btcAfterSwitch.status}`);
    console.log(`  ├─ ETH Signal ID: ${ethSignal.id}`);
    console.log(`  ├─ ETH Entry Zone: $${ethSignal.entryMin} - $${ethSignal.entryMax}`);
    console.log(`  ├─ ETH TP Price: $${ethSignal.tpPrice} (${ethSignal.tpPercent.toFixed(4)}%)`);
    console.log(`  └─ ETH SL Price: $${ethSignal.slPrice} (${ethSignal.slPercent.toFixed(4)}%)`);

    if (ethSignal.tpPrice !== 1900 || ethSignal.slPrice !== 1750) {
      throw new Error(`❌ ETH TP/SL price mismatch. Got TP ${ethSignal.tpPrice}, SL ${ethSignal.slPrice}`);
    }

    // ── STEP 5: Verify Deletion of Signal and associated trades ──
    console.log('\n💬 Phase 5: Simulating Baileys Protocol message deletion for message ID:', initialMsgId);
    
    // Simulate what the bot JID listener does
    const signalToDel = await prisma.signal.findFirst({
      where: { messageId: initialMsgId }
    });

    if (!signalToDel) {
      throw new Error('❌ Test Error: Signal to delete not found in DB.');
    }

    await prisma.$transaction([
      prisma.memberTrade.deleteMany({
        where: { signalId: signalToDel.id }
      }),
      prisma.signal.delete({
        where: { id: signalToDel.id }
      })
    ]);

    const deletedSignalResult = await prisma.signal.findUnique({ where: { id: signalToDel.id } });
    const deletedTradeResult = await prisma.memberTrade.findMany({ where: { signalId: signalToDel.id } });

    console.log('✅ Revoke / Delete Transaction Executed!');
    console.log(`  ├─ Signal Row exists after deletion: ${!!deletedSignalResult}`);
    console.log(`  └─ Number of linked member trades remaining: ${deletedTradeResult.length}`);

    if (deletedSignalResult || deletedTradeResult.length > 0) {
      throw new Error('❌ Deletion failed: Signal or associated trades were not deleted completely.');
    }

    console.log('\n🎉 ALL SIGNAL ADJUSTMENT, CONVERSATIONAL LANGUAGE, CLOSE/SWITCH, AND DELETION TESTS PASSED!');

  } catch (error: any) {
    console.error('\n❌ Test failed with error:', error.message);
    process.exit(1);
  } finally {
    // Clean up
    await prisma.memberTrade.deleteMany({ where: { memberId: dbMember.id } });
    await prisma.signal.deleteMany({ where: { adminId: TEST_ADMIN_ID } });
    await prisma.member.deleteMany({ where: { id: dbMember.id } });
    await prisma.admin.delete({ where: { id: TEST_ADMIN_ID } });
    await prisma.$disconnect();
    process.exit(0);
  }
}

testAdjustmentsAndDeletes();
