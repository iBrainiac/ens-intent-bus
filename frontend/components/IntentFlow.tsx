'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  useAccount, useChainId, useSwitchChain,
  useReadContract, useWriteContract, useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi'
import { mainnet, base } from 'wagmi/chains'
import { parseUnits, formatUnits, namehash, decodeEventLog } from 'viem'
import {
  ESCROW_ADDRESS, ESCROW_ABI, ERC20_ABI,
  ENS_REGISTRY_ADDRESS, ENS_REGISTRY_ABI, ENS_RESOLVER_ABI,
  ENS_INTENT_KEY, WETH, USDC,
} from '@/lib/contracts'

type Step = 'configure' | 'set-ens' | 'approve' | 'deposit' | 'done'

const STEPS: { id: Step; label: string; chain?: number }[] = [
  { id: 'configure', label: 'Configure' },
  { id: 'set-ens', label: 'Set ENS Record', chain: mainnet.id },
  { id: 'approve', label: 'Approve Token', chain: base.id },
  { id: 'deposit', label: 'Deposit', chain: base.id },
]


function shortAddr(addr: string) {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

function ChainGuard({ required, children }: { required: number; children: React.ReactNode }) {
  const chainId = useChainId()
  const { switchChain, isPending } = useSwitchChain()
  const chainName = required === mainnet.id ? 'Ethereum Mainnet' : 'Base'

  if (chainId === required) return <>{children}</>

  return (
    <div className="space-y-3">
      <div className="text-ink-muted text-xs px-4 py-3 border border-border bg-elevated">
        This step requires <span className="text-gold">{chainName}</span>.
        Your wallet is on a different network.
      </div>
      <button
        className="btn-gold w-full"
        onClick={() => switchChain({ chainId: required })}
        disabled={isPending}
      >
        {isPending ? 'SWITCHING...' : `SWITCH TO ${chainName.toUpperCase()}`}
      </button>
    </div>
  )
}

function TxStatus({ hash, chainId, label }: { hash?: `0x${string}`; chainId: number; label: string }) {
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash, chainId })
  const explorer = chainId === mainnet.id
    ? `https://etherscan.io/tx/${hash}`
    : `https://base.blockscout.com/tx/${hash}`

  if (!hash) return null

  return (
    <div className={`px-4 py-3 border text-xs font-mono flex items-center justify-between gap-3 ${
      isSuccess ? 'border-teal-dim bg-teal-faint text-teal' : 'border-border bg-elevated text-ink-muted'
    }`}>
      <span>{isLoading ? `${label}...` : isSuccess ? `${label} confirmed` : label}</span>
      <a href={explorer} target="_blank" rel="noopener noreferrer" className="hover:text-gold transition-colors shrink-0">
        {hash.slice(0, 10)}...↗
      </a>
    </div>
  )
}

export function IntentFlow({ ensName }: { ensName: string }) {
  const { address } = useAccount()
  const ensNode = namehash(ensName)

  const [step, setStep] = useState<Step>('configure')
  const [pairIndex, setPairIndex] = useState(0)
  const [amountStr, setAmountStr] = useState('')
  const [minOutStr, setMinOutStr] = useState('')
  const [expiryValue, setExpiryValue] = useState(1)
  const [expiryUnit, setExpiryUnit] = useState<'minutes' | 'hours'>('hours')
  const expirySeconds = expiryUnit === 'minutes' ? expiryValue * 60 : expiryValue * 3600
  const [quotedOut, setQuotedOut] = useState<string | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [depositedId, setDepositedId] = useState<bigint | null>(null)
  const [depositedHash, setDepositedHash] = useState<`0x${string}` | undefined>()

  const tokenIn = pairIndex === 0 ? WETH : USDC
  const tokenOut = pairIndex === 0 ? USDC : WETH

  const { data: nextIntentId, refetch: refetchNextId } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'nextIntentId',
    chainId: base.id,
  })

  const { data: resolverAddress } = useReadContract({
    address: ENS_REGISTRY_ADDRESS,
    abi: ENS_REGISTRY_ABI,
    functionName: 'resolver',
    args: [ensNode],
    chainId: mainnet.id,
  })

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address!, ESCROW_ADDRESS],
    chainId: base.id,
    query: { enabled: !!address && step === 'approve' },
  })

  const {
    writeContract: writeSetEns,
    data: setEnsHash,
    isPending: setEnsPending,
    error: setEnsError,
  } = useWriteContract()

  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: approvePending,
    error: approveError,
  } = useWriteContract()

  const {
    writeContract: writeDeposit,
    data: depositHash,
    isPending: depositPending,
    error: depositError,
  } = useWriteContract()

  const { isSuccess: setEnsConfirmed } = useWaitForTransactionReceipt({ hash: setEnsHash, chainId: mainnet.id })
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash, chainId: base.id })
  const { data: depositReceipt, isSuccess: depositConfirmed } = useWaitForTransactionReceipt({ hash: depositHash, chainId: base.id })

  useEffect(() => { if (setEnsConfirmed) setStep('approve') }, [setEnsConfirmed])

  useEffect(() => {
    if (!approveConfirmed) return
    refetchAllowance()
    setStep('deposit')
  }, [approveConfirmed, refetchAllowance])

  useEffect(() => {
    if (!depositConfirmed || !depositReceipt) return
    setDepositedHash(depositHash)
    for (const log of depositReceipt.logs) {
      try {
        const event = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics })
        if (event.eventName === 'IntentCreated') {
          setDepositedId(event.args.intentId as bigint)
          break
        }
      } catch {}
    }
    setStep('done')
    refetchNextId()
  }, [depositConfirmed, depositReceipt, depositHash, refetchNextId])

  // Auto-skip approve if already sufficient allowance
  useEffect(() => {
    if (step !== 'approve' || allowance === undefined || !amountStr) return
    const needed = parseUnits(amountStr, tokenIn.decimals)
    if (allowance >= needed) setStep('deposit')
  }, [step, allowance, amountStr, tokenIn.decimals])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchQuote = useCallback(async (amount: string) => {
    if (!amount || parseFloat(amount) <= 0) { setQuotedOut(null); return }
    setQuoteLoading(true)
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          tokenInChainId: String(base.id),
          tokenOutChainId: String(base.id),
          amount: parseUnits(amount, tokenIn.decimals).toString(),
          type: 'EXACT_INPUT',
          swapper: ESCROW_ADDRESS,
          routingPreference: 'CLASSIC',
          slippageTolerance: 0.5,
        }),
      })
      const data = await res.json()
      if (data?.quote?.output?.amount) {
        const out = data.quote.output.amount as string
        const outFormatted = formatUnits(BigInt(out), tokenOut.decimals)
        setQuotedOut(outFormatted)
        // Pre-fill min out at 0.5% slippage
        const minOut = (BigInt(out) * 995n / 1000n)
        setMinOutStr(formatUnits(minOut, tokenOut.decimals))
      }
    } catch {
      setQuotedOut(null)
    } finally {
      setQuoteLoading(false)
    }
  }, [tokenIn, tokenOut])

  const handleAmountChange = (val: string) => {
    setAmountStr(val)
    setQuotedOut(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchQuote(val), 600)
  }

  const stepIndex = STEPS.findIndex(s => s.id === step)

  const isValidConfig = amountStr && parseFloat(amountStr) > 0 && minOutStr && parseFloat(minOutStr) > 0

  function handleReset() {
    setStep('configure')
    setAmountStr('')
    setMinOutStr('')
    setQuotedOut(null)
    setDepositedId(null)
    setDepositedHash(undefined)
    setExpiryValue(1)
    setExpiryUnit('hours')
    refetchNextId()
  }

  return (
    <div className="border border-border bg-card">
      {/* Step indicator */}
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-0">
          {STEPS.map((s, i) => {
            const isActive = s.id === step
            const isDone = stepIndex > i || step === 'done'
            return (
              <div key={s.id} className="flex items-center gap-0">
                <div className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors ${
                  isActive ? 'text-gold' : isDone ? 'text-teal' : 'text-ink-faint'
                }`}>
                  <span className={`w-5 h-5 flex items-center justify-center border text-xs ${
                    isActive ? 'border-gold text-gold' :
                    isDone ? 'border-teal text-teal' :
                    'border-ink-faint text-ink-faint'
                  }`}>
                    {isDone && step !== 'done' ? '✓' : i + 1}
                  </span>
                  <span className="hidden sm:block tracking-wider uppercase">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-px ${isDone ? 'bg-teal-dim' : 'bg-border'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="p-5 space-y-4">

        {/* ── CONFIGURE ── */}
        {step === 'configure' && (
          <div className="space-y-5 animate-fade-up">
            <div className="space-y-1">
              <p className="label">token pair</p>
              <div className="grid grid-cols-2 gap-0">
                {['WETH → USDC', 'USDC → WETH'].map((label, i) => (
                  <button
                    key={i}
                    onClick={() => { setPairIndex(i); setAmountStr(''); setMinOutStr(''); setQuotedOut(null) }}
                    className={`px-4 py-2.5 text-xs font-mono tracking-wider border transition-colors ${
                      pairIndex === i
                        ? 'bg-gold-faint border-gold-dim text-gold'
                        : 'bg-page border-border text-ink-muted hover:border-border-strong hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <p className="label">amount in</p>
                <span className="text-ink-muted text-xs">{tokenIn.symbol}</span>
              </div>
              <input
                type="number"
                className="input-field"
                placeholder={`0.00`}
                value={amountStr}
                onChange={e => handleAmountChange(e.target.value)}
                min="0"
                step="any"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <p className="label">minimum output</p>
                <span className="text-ink-muted text-xs">
                  {tokenOut.symbol}
                  {quoteLoading && <span className="ml-2 animate-pulse-soft">fetching quote...</span>}
                  {quotedOut && !quoteLoading && (
                    <span className="ml-2 text-teal">quoted ~{parseFloat(quotedOut).toFixed(4)}</span>
                  )}
                </span>
              </div>
              <input
                type="number"
                className="input-field"
                placeholder={`0.00`}
                value={minOutStr}
                onChange={e => setMinOutStr(e.target.value)}
                min="0"
                step="any"
              />
              <p className="text-ink-faint text-xs">Swap reverts if output falls below this amount.</p>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <p className="label">intent expiry</p>
                <span className="text-ink-muted text-xs">{expirySeconds < 3600 ? `${expirySeconds / 60}m` : `${expirySeconds / 3600}h`} from now</span>
              </div>
              <div className="flex gap-0">
                <input
                  type="number"
                  className="input-field flex-1"
                  min="1"
                  value={expiryValue}
                  onChange={e => setExpiryValue(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <div className="flex border border-l-0 border-border">
                  {(['minutes', 'hours'] as const).map(unit => (
                    <button
                      key={unit}
                      onClick={() => setExpiryUnit(unit)}
                      className={`px-4 py-3 text-xs font-mono tracking-wider transition-colors ${
                        expiryUnit === unit
                          ? 'bg-gold-faint text-gold'
                          : 'bg-page text-ink-muted hover:text-ink'
                      }`}
                    >
                      {unit === 'minutes' ? 'MIN' : 'HRS'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 px-4 py-3 bg-elevated border border-border text-xs font-mono space-y-1 text-ink-muted">
              <div className="flex justify-between">
                <span>predicted intent id</span>
                <span className="text-gold">{nextIntentId !== undefined ? `#${nextIntentId}` : '...'}</span>
              </div>
              <div className="flex justify-between">
                <span>ens record to set</span>
                <span className="text-gold">{nextIntentId !== undefined ? `"${nextIntentId}"` : '...'}</span>
              </div>
              <div className="flex justify-between">
                <span>ens name</span>
                <span className="text-ink">{ensName}</span>
              </div>
            </div>

            <button
              className="btn-gold w-full"
              disabled={!isValidConfig || nextIntentId === undefined}
              onClick={() => setStep('set-ens')}
            >
              CONTINUE →
            </button>
          </div>
        )}

        {/* ── SET ENS RECORD ── */}
        {step === 'set-ens' && (
          <div className="space-y-4 animate-fade-up">
            <div className="px-4 py-3 bg-elevated border border-border text-xs font-mono space-y-2">
              <p className="text-ink-muted">ENS text record to write on <span className="text-gold">Ethereum Mainnet</span></p>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-2">
                <span className="label">name</span>
                <span className="text-ink">{ensName}</span>
                <span className="label">key</span>
                <span className="text-ink">{ENS_INTENT_KEY}</span>
                <span className="label">value</span>
                <span className="text-gold">{nextIntentId?.toString()}</span>
              </div>
            </div>

            <ChainGuard required={mainnet.id}>
              <div className="space-y-3">
                <button
                  className="btn-gold w-full"
                  disabled={setEnsPending || !resolverAddress || nextIntentId === undefined}
                  onClick={() => writeSetEns({
                    address: resolverAddress!,
                    abi: ENS_RESOLVER_ABI,
                    functionName: 'setText',
                    args: [ensNode, ENS_INTENT_KEY, nextIntentId!.toString()],
                    chainId: mainnet.id,
                  })}
                >
                  {setEnsPending ? 'CONFIRM IN WALLET...' : 'SET ENS RECORD'}
                </button>
                {setEnsError && (
                  <p className="text-crimson text-xs px-4 py-2 bg-crimson-faint border border-crimson-dim">
                    {setEnsError.message.split('\n')[0]}
                  </p>
                )}
                <TxStatus hash={setEnsHash} chainId={mainnet.id} label="setText" />
                {setEnsHash && (
                  <button className="btn-gold w-full" onClick={() => setStep('approve')}>
                    CONTINUE TO APPROVE →
                  </button>
                )}
              </div>
            </ChainGuard>

            <button className="btn-outline w-full" onClick={() => setStep('configure')}>← BACK</button>
          </div>
        )}

        {/* ── APPROVE ── */}
        {step === 'approve' && (
          <div className="space-y-4 animate-fade-up">
            <div className="px-4 py-3 bg-elevated border border-border text-xs font-mono space-y-2">
              <p className="text-ink-muted">Approve <span className="text-gold">Base</span> escrow to spend your tokens</p>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-2">
                <span className="label">token</span>
                <span className="text-ink">{tokenIn.symbol}</span>
                <span className="label">amount</span>
                <span className="text-ink">{amountStr} {tokenIn.symbol}</span>
                <span className="label">spender</span>
                <span className="text-ink">{shortAddr(ESCROW_ADDRESS)}</span>
              </div>
            </div>

            <ChainGuard required={base.id}>
              <div className="space-y-3">
                <button
                  className="btn-gold w-full"
                  disabled={approvePending}
                  onClick={() => writeApprove({
                    address: tokenIn.address,
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [ESCROW_ADDRESS, parseUnits(amountStr, tokenIn.decimals)],
                    chainId: base.id,
                  })}
                >
                  {approvePending ? 'CONFIRM IN WALLET...' : `APPROVE ${tokenIn.symbol}`}
                </button>
                {approveError && (
                  <p className="text-crimson text-xs px-4 py-2 bg-crimson-faint border border-crimson-dim">
                    {approveError.message.split('\n')[0]}
                  </p>
                )}
                <TxStatus hash={approveHash} chainId={base.id} label="approve" />
              </div>
            </ChainGuard>
          </div>
        )}

        {/* ── DEPOSIT ── */}
        {step === 'deposit' && (
          <div className="space-y-4 animate-fade-up">
            <div className="px-4 py-3 bg-elevated border border-border text-xs font-mono space-y-2">
              <p className="text-ink-muted">Create intent on <span className="text-gold">Base Mainnet</span></p>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-2">
                <span className="label">intent id</span>
                <span className="text-gold">#{nextIntentId?.toString()}</span>
                <span className="label">sell</span>
                <span className="text-ink">{amountStr} {tokenIn.symbol}</span>
                <span className="label">min receive</span>
                <span className="text-ink">{parseFloat(minOutStr).toFixed(4)} {tokenOut.symbol}</span>
                <span className="label">expiry</span>
                <span className="text-ink">{expiryValue} {expiryUnit}</span>
                <span className="label">ens node</span>
                <span className="text-ink truncate">{ensName}</span>
              </div>
            </div>

            <ChainGuard required={base.id}>
              <div className="space-y-3">
                <button
                  className="btn-gold w-full"
                  disabled={depositPending || nextIntentId === undefined}
                  onClick={() => writeDeposit({
                    address: ESCROW_ADDRESS,
                    abi: ESCROW_ABI,
                    functionName: 'deposit',
                    args: [
                      ensNode,
                      tokenIn.address,
                      tokenOut.address,
                      parseUnits(amountStr, tokenIn.decimals),
                      parseUnits(minOutStr, tokenOut.decimals),
                      BigInt(Math.floor(Date.now() / 1000) + expirySeconds),
                    ],
                    chainId: base.id,
                  })}
                >
                  {depositPending ? 'CONFIRM IN WALLET...' : 'DEPOSIT & CREATE INTENT'}
                </button>
                {depositError && (
                  <p className="text-crimson text-xs px-4 py-2 bg-crimson-faint border border-crimson-dim">
                    {depositError.message.split('\n')[0]}
                  </p>
                )}
                <TxStatus hash={depositHash} chainId={base.id} label="deposit" />
              </div>
            </ChainGuard>
          </div>
        )}

        {/* ── DONE ── */}
        {step === 'done' && (
          <div className="space-y-4 animate-fade-up">
            <div className="px-5 py-6 border border-teal-dim bg-teal-faint text-center space-y-2">
              <p className="text-teal font-display text-2xl italic">Intent Created</p>
              <p className="text-teal text-xs font-mono">
                #{depositedId?.toString()} · Agent is watching the chain
              </p>
            </div>

            <div className="px-4 py-3 bg-elevated border border-border text-xs font-mono space-y-1.5 text-ink-muted">
              <p>The agent will now:</p>
              <p className="text-ink">① Detect your <span className="text-gold">IntentCreated</span> event</p>
              <p className="text-ink">② Verify your ENS identity via three-layer check</p>
              <p className="text-ink">③ Fetch optimal calldata from Uniswap Trading API</p>
              <p className="text-ink">④ Execute the swap and send {tokenOut.symbol} to your wallet</p>
            </div>

            {depositedHash && (
              <a
                href={`https://base.blockscout.com/tx/${depositedHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-xs font-mono text-ink-muted hover:text-gold transition-colors py-2"
              >
                View deposit tx ↗
              </a>
            )}

            <button className="btn-outline w-full" onClick={handleReset}>
              CREATE ANOTHER INTENT
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
