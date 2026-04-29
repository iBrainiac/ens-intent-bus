'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  useAccount, useChainId, useSwitchChain,
  useReadContract, useWriteContract, useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi'
import { mainnet, base } from 'wagmi/chains'
import { parseUnits, namehash, decodeEventLog, parseAbiItem, formatUnits } from 'viem'
import {
  ESCROW_ADDRESS, ESCROW_ABI, ERC20_ABI,
  ENS_REGISTRY_ADDRESS, ENS_REGISTRY_ABI, ENS_RESOLVER_ABI,
  ENS_INTENT_KEY, WETH, USDC, DEPLOYMENT_BLOCK,
} from '@/lib/contracts'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  txHash?: string
  txChain?: number
  isAction?: boolean
}

interface PendingIntent {
  tokenIn: typeof WETH | typeof USDC
  tokenOut: typeof WETH | typeof USDC
  amount: string
  expiryMinutes: number
}

interface UserIntent {
  id: string
  tokenIn: string
  tokenOut: string
  amountIn: string
  status: number
}

type TxPhase = 'idle' | 'set-ens' | 'approve' | 'deposit' | 'done'

function tokenBySymbol(symbol: string) {
  return symbol === 'WETH' ? WETH : USDC
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

export function ChatInterface({ ensName }: { ensName: string }) {
  const { address } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: base.id })
  const ensNode = namehash(ensName)

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Connected as **${ensName}**. I can swap WETH ↔ USDC on Base via Uniswap.\n\nTry: *"swap 5 USDC to WETH in 1 hour"* or *"what's my intent status?"*`,
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null)
  const [txPhase, setTxPhase] = useState<TxPhase>('idle')
  const [cancelIntentId, setCancelIntentId] = useState<bigint | null>(null)
  const [userIntents, setUserIntents] = useState<UserIntent[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Contract reads
  const { data: nextIntentId } = useReadContract({
    address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: 'nextIntentId', chainId: base.id,
  })
  const { data: resolverAddress } = useReadContract({
    address: ENS_REGISTRY_ADDRESS, abi: ENS_REGISTRY_ABI, functionName: 'resolver',
    args: [ensNode], chainId: mainnet.id,
  })
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: pendingIntent?.tokenIn.address ?? USDC.address,
    abi: ERC20_ABI, functionName: 'allowance',
    args: [address!, ESCROW_ADDRESS], chainId: base.id,
    query: { enabled: !!address && txPhase === 'approve' },
  })

  // Write hooks
  const { writeContract: writeSetEns, data: setEnsHash, isPending: setEnsPending, error: setEnsError } = useWriteContract()
  const { writeContract: writeApprove, data: approveHash, isPending: approvePending, error: approveError } = useWriteContract()
  const { writeContract: writeDeposit, data: depositHash, isPending: depositPending, error: depositError } = useWriteContract()
  const { writeContract: writeCancelTx, data: cancelHash, isPending: cancelPending } = useWriteContract()

  // Receipts
  const { isSuccess: setEnsConfirmed } = useWaitForTransactionReceipt({ hash: setEnsHash, chainId: mainnet.id })
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash, chainId: base.id })
  const { data: depositReceipt, isSuccess: depositConfirmed } = useWaitForTransactionReceipt({ hash: depositHash, chainId: base.id })
  const { isSuccess: cancelConfirmed } = useWaitForTransactionReceipt({ hash: cancelHash, chainId: base.id })

  // Fetch user intents for context
  const fetchIntents = useCallback(async () => {
    if (!address || !publicClient) return []
    try {
      const logs = await publicClient.getLogs({
        address: ESCROW_ADDRESS,
        event: parseAbiItem('event IntentCreated(uint256 indexed intentId, address indexed user, bytes32 ensNode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 expiry)'),
        args: { user: address },
        fromBlock: DEPLOYMENT_BLOCK,
        toBlock: 'latest',
      })
      const ids = logs.map(l => l.args.intentId as bigint)
      if (!ids.length) return []
      const results = await Promise.all(ids.map(id =>
        publicClient.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: 'getIntent', args: [id] })
      ))
      const intents = results.map((r, i) => ({
        id: ids[i].toString(),
        tokenIn: r[2].toLowerCase() === WETH.address.toLowerCase() ? 'WETH' : 'USDC',
        tokenOut: r[3].toLowerCase() === USDC.address.toLowerCase() ? 'USDC' : 'WETH',
        amountIn: formatUnits(r[4], r[2].toLowerCase() === WETH.address.toLowerCase() ? 18 : 6),
        status: r[7],
      }))
      setUserIntents(intents)
      return intents
    } catch { return [] }
  }, [address, publicClient])

  useEffect(() => { fetchIntents() }, [fetchIntents])

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, txPhase])

  // TX phase transitions
  useEffect(() => {
    if (setEnsConfirmed && txPhase === 'set-ens') {
      addAssistantMessage('ENS record confirmed. Switching to Base for approval...', setEnsHash, mainnet.id)
      setTxPhase('approve')
    }
  }, [setEnsConfirmed])

  useEffect(() => {
    if (approveConfirmed && txPhase === 'approve') {
      refetchAllowance()
      addAssistantMessage('Approval confirmed. Ready to deposit into escrow...', approveHash, base.id)
      setTxPhase('deposit')
    }
  }, [approveConfirmed])

  useEffect(() => {
    if (!depositConfirmed || !depositReceipt || txPhase !== 'deposit') return
    let intentId: bigint | null = null
    for (const log of depositReceipt.logs) {
      try {
        const event = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics })
        if (event.eventName === 'IntentCreated') { intentId = event.args.intentId as bigint; break }
      } catch {}
    }
    const msg = intentId !== null
      ? `Intent #${intentId} created on Base. The agent is now watching for your ENS record and will execute the swap automatically. You'll receive ${pendingIntent?.tokenOut.symbol} in your wallet once executed.`
      : 'Deposit confirmed. Intent created and agent is watching.'
    addAssistantMessage(msg, depositHash, base.id)
    setPendingIntent(null)
    setTxPhase('done')
    fetchIntents()
  }, [depositConfirmed, depositReceipt])

  useEffect(() => {
    if (cancelConfirmed && cancelIntentId !== null) {
      addAssistantMessage(`Intent #${cancelIntentId} cancelled. Your tokens have been returned.`, cancelHash, base.id)
      setCancelIntentId(null)
      fetchIntents()
    }
  }, [cancelConfirmed])

  // Auto-skip approve if sufficient allowance
  useEffect(() => {
    if (txPhase !== 'approve' || !pendingIntent || allowance === undefined) return
    const needed = parseUnits(pendingIntent.amount, pendingIntent.tokenIn.decimals)
    if (allowance >= needed) {
      addAssistantMessage('Allowance already sufficient. Proceeding to deposit...')
      setTxPhase('deposit')
    }
  }, [txPhase, allowance, pendingIntent])

  function addAssistantMessage(content: string, txHash?: `0x${string}`, txChain?: number) {
    setMessages(prev => [...prev, { role: 'assistant', content, txHash, txChain, isAction: !!txHash }])
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || thinking || txPhase !== 'idle') return
    setInput('')
    const userMsg: ChatMessage = { role: 'user', content: text }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setThinking(true)

    try {
      const freshIntents = await fetchIntents()
      const apiMessages = updated
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, ensName, address, intents: freshIntents }),
      })
      const data = await res.json()
      const msg = data.message

      if (msg.tool_calls?.length) {
        const call = msg.tool_calls[0]
        const args = JSON.parse(call.function.arguments)

        if (call.function.name === 'create_intent') {
          const tIn = tokenBySymbol(args.tokenIn)
          const tOut = tokenBySymbol(args.tokenOut)
          const intent: PendingIntent = {
            tokenIn: tIn, tokenOut: tOut,
            amount: args.amount,
            expiryMinutes: args.expiryMinutes,
          }
          setPendingIntent(intent)
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `I'll set up this intent for you:\n\n**Sell:** ${args.amount} ${tIn.symbol}\n**Receive:** ${tOut.symbol} (min output set at 0.5% slippage)\n**Expires:** ${args.expiryMinutes} minutes\n**Intent ID:** #${nextIntentId ?? '?'}\n\nThis requires 3 transactions: set ENS record (Mainnet) → approve token (Base) → deposit (Base).\n\nClick **Start** below to begin.`,
            isAction: true,
          }])
        } else if (call.function.name === 'get_status') {
          const filter = args.filter as string
          const filtered = freshIntents.filter(i =>
            filter === 'all' ? true :
            filter === 'pending' ? i.status === 0 :
            filter === 'executed' ? i.status === 1 :
            i.status === 2
          )
          const statusLabel = ['PENDING', 'EXECUTED', 'CANCELLED']
          const reply = filtered.length
            ? filtered.map(i => `**#${i.id}** — ${i.amountIn} ${i.tokenIn} → ${i.tokenOut} · ${statusLabel[i.status]}`).join('\n')
            : `No ${filter === 'all' ? '' : filter + ' '}intents found.`
          setMessages(prev => [...prev, { role: 'assistant', content: reply }])
        } else if (call.function.name === 'cancel_intent') {
          const id = BigInt(args.intentId)
          setCancelIntentId(id)
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Cancelling intent #${args.intentId}. Click **Cancel Intent** to confirm.`,
            isAction: true,
          }])
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: msg.content ?? '' }])
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setThinking(false)
      inputRef.current?.focus()
    }
  }

  // TX execution helpers
  async function startIntentFlow() {
    if (!pendingIntent || !resolverAddress || nextIntentId === undefined) return
    if (chainId !== mainnet.id) { await switchChain({ chainId: mainnet.id }); return }
    addAssistantMessage(`Setting ENS text record on ${ensName} (Ethereum Mainnet)...`)
    setTxPhase('set-ens')
    writeSetEns({
      address: resolverAddress,
      abi: ENS_RESOLVER_ABI,
      functionName: 'setText',
      args: [ensNode, ENS_INTENT_KEY, nextIntentId.toString()],
      chainId: mainnet.id,
    })
  }

  async function doApprove() {
    if (!pendingIntent) return
    if (chainId !== base.id) { await switchChain({ chainId: base.id }); return }
    addAssistantMessage(`Approving ${pendingIntent.amount} ${pendingIntent.tokenIn.symbol} for the escrow...`)
    writeApprove({
      address: pendingIntent.tokenIn.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ESCROW_ADDRESS, parseUnits(pendingIntent.amount, pendingIntent.tokenIn.decimals)],
      chainId: base.id,
    })
  }

  async function doDeposit() {
    if (!pendingIntent || nextIntentId === undefined) return
    if (chainId !== base.id) { await switchChain({ chainId: base.id }); return }
    addAssistantMessage(`Depositing ${pendingIntent.amount} ${pendingIntent.tokenIn.symbol} into escrow...`)
    const minOut = parseUnits(pendingIntent.amount, pendingIntent.tokenOut.decimals) * 995n / 1000n
    writeDeposit({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'deposit',
      args: [
        ensNode,
        pendingIntent.tokenIn.address,
        pendingIntent.tokenOut.address,
        parseUnits(pendingIntent.amount, pendingIntent.tokenIn.decimals),
        minOut,
        BigInt(Math.floor(Date.now() / 1000) + pendingIntent.expiryMinutes * 60),
      ],
      chainId: base.id,
    })
  }

  function doCancel() {
    if (cancelIntentId === null) return
    writeCancelTx({
      address: ESCROW_ADDRESS, abi: ESCROW_ABI,
      functionName: 'cancel', args: [cancelIntentId], chainId: base.id,
    })
  }

  const txError = setEnsError || approveError || depositError
  const isBusy = setEnsPending || approvePending || depositPending || cancelPending

  // Determine which action button to show
  const showStart = pendingIntent && txPhase === 'idle'
  const showSetEns = txPhase === 'set-ens' && setEnsHash && !setEnsConfirmed
  const showManualEnsAdvance = txPhase === 'set-ens' && setEnsHash
  const showApprove = txPhase === 'approve'
  const showDeposit = txPhase === 'deposit'
  const showCancelBtn = cancelIntentId !== null && txPhase === 'idle'

  function renderMessage(msg: ChatMessage, i: number) {
    const isUser = msg.role === 'user'
    const parts = msg.content.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
    const formatted = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={j} className="text-ink font-bold">{part.slice(2, -2)}</strong>
      if (part.startsWith('*') && part.endsWith('*')) return <em key={j} className="text-gold">{part.slice(1, -1)}</em>
      return <span key={j}>{part}</span>
    })

    return (
      <div key={i} className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`w-6 h-6 shrink-0 flex items-center justify-center border text-xs font-mono mt-0.5 ${
          isUser ? 'border-gold-dim text-gold bg-gold-faint' : 'border-border text-ink-muted bg-elevated'
        }`}>
          {isUser ? 'U' : 'A'}
        </div>
        <div className={`max-w-[85%] space-y-1`}>
          <div className={`px-4 py-3 text-xs font-mono leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-gold-faint border border-gold-dim text-ink'
              : msg.isAction
              ? 'bg-elevated border border-border-strong text-ink'
              : 'bg-card border border-border text-ink-muted'
          }`}>
            {formatted}
          </div>
          {msg.txHash && (
            <a
              href={`${msg.txChain === mainnet.id ? 'https://etherscan.io/tx/' : 'https://base.blockscout.com/tx/'}${msg.txHash}`}
              target="_blank" rel="noopener noreferrer"
              className="text-ink-faint text-xs hover:text-gold transition-colors font-mono"
            >
              {shortHash(msg.txHash)} ↗
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border bg-card flex flex-col h-[600px]">
      {/* Header */}
      <div className="border-b border-border px-5 py-3.5 flex items-center justify-between shrink-0">
        <span className="label">agent chat</span>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse-soft" />
          <span className="text-teal text-xs font-mono label">online</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.map((msg, i) => renderMessage(msg, i))}

        {thinking && (
          <div className="flex gap-3">
            <div className="w-6 h-6 shrink-0 flex items-center justify-center border border-border text-ink-muted bg-elevated text-xs font-mono mt-0.5">A</div>
            <div className="px-4 py-3 bg-card border border-border text-ink-muted text-xs font-mono animate-pulse-soft">
              thinking...
            </div>
          </div>
        )}

        {/* TX action buttons */}
        {(showStart || showApprove || showDeposit || showCancelBtn || showManualEnsAdvance) && (
          <div className="flex gap-2 flex-wrap pl-9">
            {showStart && (
              <button className="btn-gold text-xs py-2 px-4" onClick={startIntentFlow} disabled={isBusy}>
                {chainId !== mainnet.id ? 'SWITCH TO MAINNET & START' : 'START →'}
              </button>
            )}
            {showManualEnsAdvance && (
              <button className="btn-gold text-xs py-2 px-4" onClick={() => {
                addAssistantMessage('ENS record set. Proceeding to approve...')
                setTxPhase('approve')
              }}>
                CONTINUE TO APPROVE →
              </button>
            )}
            {showApprove && (
              <button className="btn-gold text-xs py-2 px-4" onClick={doApprove} disabled={isBusy}>
                {chainId !== base.id ? 'SWITCH TO BASE' : approvePending ? 'CONFIRM IN WALLET...' : 'APPROVE TOKEN'}
              </button>
            )}
            {showDeposit && (
              <button className="btn-gold text-xs py-2 px-4" onClick={doDeposit} disabled={isBusy}>
                {chainId !== base.id ? 'SWITCH TO BASE' : depositPending ? 'CONFIRM IN WALLET...' : 'DEPOSIT'}
              </button>
            )}
            {showCancelBtn && (
              <button
                className="btn-outline text-xs py-2 px-4 border-crimson-dim text-crimson hover:border-crimson"
                onClick={doCancel} disabled={cancelPending}
              >
                {cancelPending ? 'CANCELLING...' : 'CANCEL INTENT'}
              </button>
            )}
            {(txPhase === 'set-ens' || txPhase === 'approve' || txPhase === 'deposit') && (
              <button className="btn-outline text-xs py-2 px-4" onClick={() => {
                setPendingIntent(null); setTxPhase('idle')
                addAssistantMessage('Transaction flow cancelled.')
              }}>
                ABORT
              </button>
            )}
          </div>
        )}

        {txError && (
          <div className="ml-9 text-crimson text-xs px-3 py-2 bg-crimson-faint border border-crimson-dim font-mono">
            {txError.message.split('\n')[0]}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-3 flex gap-2 shrink-0">
        <input
          ref={inputRef}
          type="text"
          className="input-field flex-1 py-2"
          placeholder={txPhase !== 'idle' ? 'Complete the transaction above first...' : 'swap 5 USDC to WETH in 30 minutes...'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          disabled={thinking || txPhase !== 'idle'}
        />
        <button
          className="btn-gold px-5 py-2 shrink-0"
          onClick={handleSend}
          disabled={thinking || !input.trim() || txPhase !== 'idle'}
        >
          {thinking ? '...' : '↑'}
        </button>
      </div>
    </div>
  )
}
