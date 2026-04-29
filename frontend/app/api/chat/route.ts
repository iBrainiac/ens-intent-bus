import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_intent',
      description: 'Create a swap intent. Called when the user wants to swap tokens.',
      parameters: {
        type: 'object',
        properties: {
          tokenIn: { type: 'string', enum: ['WETH', 'USDC'], description: 'Token to sell' },
          tokenOut: { type: 'string', enum: ['WETH', 'USDC'], description: 'Token to receive' },
          amount: { type: 'string', description: 'Amount to sell as a decimal string, e.g. "0.01" or "5"' },
          expiryMinutes: { type: 'number', description: 'How many minutes until the intent expires' },
        },
        required: ['tokenIn', 'tokenOut', 'amount', 'expiryMinutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: 'Get the status of the user\'s intents. Called when the user asks about their swaps or intent status.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'pending', 'executed', 'cancelled'],
            description: 'Which intents to show',
          },
        },
        required: ['filter'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_intent',
      description: 'Cancel a pending intent by its ID.',
      parameters: {
        type: 'object',
        properties: {
          intentId: { type: 'string', description: 'The intent ID to cancel' },
        },
        required: ['intentId'],
      },
    },
  },
]

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })

  const { messages, ensName, address, intents } = await req.json()

  const intentsSummary = intents?.length
    ? intents.map((i: { id: string; tokenIn: string; tokenOut: string; amountIn: string; status: number }) =>
        `Intent #${i.id}: ${i.tokenIn} → ${i.tokenOut}, amount: ${i.amountIn}, status: ${['PENDING', 'EXECUTED', 'CANCELLED'][i.status] ?? 'UNKNOWN'}`
      ).join('\n')
    : 'No intents yet.'

  const systemPrompt = `You are the ens-intent-bus agent — an AI-powered swap executor on Base network with ENS identity.

You help users create and manage swap intents. A swap intent is a signed declaration of a user's trade, published via their ENS name. You (the agent) watch the blockchain, verify their ENS identity, and execute the swap via Uniswap on their behalf.

USER CONTEXT:
- ENS Name: ${ensName ?? 'unknown'}
- Address: ${address ?? 'unknown'}
- Supported tokens: WETH (Wrapped Ether) and USDC on Base mainnet
- Agent fee: 0.3% of swap output

USER'S CURRENT INTENTS:
${intentsSummary}

BEHAVIOR:
- Be concise and direct. You are a financial agent, not a chatbot.
- When the user wants to swap, call create_intent with the parsed parameters.
- When they ask about status, call get_status.
- When they want to cancel, call cancel_intent with the intent ID.
- If the user's request is ambiguous (e.g. missing amount), ask one clarifying question.
- For general questions about how the system works, answer briefly in plain text.
- Always confirm the trade parameters before creating an intent.
- Amounts must be positive numbers. Expiry must be at least 1 minute.
- WETH and USDC are the only supported tokens. If user asks for ETH, treat as WETH.`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    tools: TOOLS,
    tool_choice: 'auto',
    max_tokens: 500,
  })

  const choice = response.choices[0]
  return NextResponse.json({
    message: choice.message,
    finishReason: choice.finish_reason,
  })
}
