'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { base } from 'wagmi/chains'
import { parseAbiItem, formatUnits } from 'viem'
import { ESCROW_ADDRESS, ESCROW_ABI, ERC20_ABI, WETH, USDC, DEPLOYMENT_BLOCK, INTENT_STATUS } from '@/lib/contracts'

interface Intent {
  id: bigint
  user: `0x${string}`
  ensNode: `0x${string}`
  tokenIn: `0x${string}`
  tokenOut: `0x${string}`
  amountIn: bigint
  minAmountOut: bigint
  expiry: bigint
  status: number
}

function tokenMeta(address: string) {
  if (address.toLowerCase() === WETH.address.toLowerCase()) return WETH
  if (address.toLowerCase() === USDC.address.toLowerCase()) return USDC
  return { symbol: 'TOKEN', decimals: 18 }
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function TimeRemaining({ expiry }: { expiry: bigint }) {
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    function update() {
      const now = BigInt(Math.floor(Date.now() / 1000))
      if (expiry <= now) { setRemaining('expired'); return }
      const secs = Number(expiry - now)
      if (secs < 60) setRemaining(`${secs}s`)
      else if (secs < 3600) setRemaining(`${Math.floor(secs / 60)}m`)
      else setRemaining(`${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`)
    }
    update()
    const interval = setInterval(update, 10_000)
    return () => clearInterval(interval)
  }, [expiry])

  const isExpired = expiry <= BigInt(Math.floor(Date.now() / 1000))
  return <span className={isExpired ? 'text-crimson' : 'text-ink-muted'}>{remaining}</span>
}

function CancelButton({ intentId, onCancelled }: { intentId: bigint; onCancelled: () => void }) {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isSuccess } = useWaitForTransactionReceipt({ hash, chainId: base.id })

  useEffect(() => { if (isSuccess) onCancelled() }, [isSuccess, onCancelled])

  return (
    <div className="space-y-1">
      <button
        className="btn-outline text-xs py-1.5 px-3 border-crimson-dim text-crimson hover:border-crimson hover:text-crimson"
        disabled={isPending}
        onClick={() => writeContract({
          address: ESCROW_ADDRESS,
          abi: ESCROW_ABI,
          functionName: 'cancel',
          args: [intentId],
          chainId: base.id,
        })}
      >
        {isPending ? 'CANCELLING...' : 'CANCEL'}
      </button>
      {error && <p className="text-crimson text-xs">{error.message.split('\n')[0]}</p>}
    </div>
  )
}

export function IntentDashboard() {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: base.id })
  const [intents, setIntents] = useState<Intent[]>([])
  const [loading, setLoading] = useState(false)

  const fetchIntents = useCallback(async () => {
    if (!address || !publicClient) return
    setLoading(true)
    try {
      const logs = await publicClient.getLogs({
        address: ESCROW_ADDRESS,
        event: parseAbiItem('event IntentCreated(uint256 indexed intentId, address indexed user, bytes32 ensNode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 expiry)'),
        args: { user: address },
        fromBlock: DEPLOYMENT_BLOCK,
        toBlock: 'latest',
      })

      const intentIds = logs.map(l => l.args.intentId as bigint)
      if (intentIds.length === 0) { setIntents([]); return }

      const results = await Promise.all(
        intentIds.map(id =>
          publicClient.readContract({
            address: ESCROW_ADDRESS,
            abi: ESCROW_ABI,
            functionName: 'getIntent',
            args: [id],
          })
        )
      )

      setIntents(results.map((r, i) => ({
        id: intentIds[i],
        user: r[0],
        ensNode: r[1],
        tokenIn: r[2],
        tokenOut: r[3],
        amountIn: r[4],
        minAmountOut: r[5],
        expiry: r[6],
        status: r[7],
      })))
    } catch (e) {
      console.error('fetchIntents error:', e)
    } finally {
      setLoading(false)
    }
  }, [address, publicClient])

  useEffect(() => { fetchIntents() }, [fetchIntents])

  if (!address) return null

  const statusLabel = (s: number) => INTENT_STATUS[s as keyof typeof INTENT_STATUS] ?? 'UNKNOWN'
  const statusClass = (s: number) => {
    if (s === 0) return 'status-pending'
    if (s === 1) return 'status-executed'
    return 'status-cancelled'
  }

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <span className="label">your intents</span>
        <button
          className="text-ink-muted text-xs hover:text-gold transition-colors font-mono"
          onClick={fetchIntents}
          disabled={loading}
        >
          {loading ? 'loading...' : '↺ refresh'}
        </button>
      </div>

      {intents.length === 0 ? (
        <div className="px-5 py-10 text-center text-ink-muted text-xs font-mono">
          {loading ? 'loading intents...' : 'no intents found for this wallet'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {[...intents].reverse().map(intent => {
            const inMeta = tokenMeta(intent.tokenIn)
            const outMeta = tokenMeta(intent.tokenOut)
            return (
              <div key={intent.id.toString()} className="px-5 py-4 grid sm:grid-cols-[1fr_auto] gap-3 items-start">
                <div className="space-y-2">
                  {/* Header row */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-ink font-mono text-xs font-bold">#{intent.id.toString()}</span>
                    <span className={`text-xs px-2 py-0.5 font-mono tracking-wider ${statusClass(intent.status)}`}>
                      {statusLabel(intent.status)}
                    </span>
                  </div>

                  {/* Trade details */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="space-y-0.5">
                      <p className="label">sell</p>
                      <p className="text-ink">
                        {formatUnits(intent.amountIn, inMeta.decimals)} {inMeta.symbol}
                      </p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="label">min receive</p>
                      <p className="text-ink">
                        {parseFloat(formatUnits(intent.minAmountOut, outMeta.decimals)).toFixed(4)} {outMeta.symbol}
                      </p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="label">expiry</p>
                      <TimeRemaining expiry={intent.expiry} />
                    </div>
                    <div className="space-y-0.5">
                      <p className="label">tx</p>
                      <a
                        href={`https://base.blockscout.com/address/${ESCROW_ADDRESS}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-muted hover:text-gold transition-colors"
                      >
                        view ↗
                      </a>
                    </div>
                  </div>
                </div>

                {intent.status === 0 && (
                  <CancelButton
                    intentId={intent.id}
                    onCancelled={fetchIntents}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
