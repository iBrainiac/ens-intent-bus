'use client'

import { useEffect, useState, useRef } from 'react'
import { useEnsName, useEnsAvatar } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import Image from 'next/image'
import { AGENT_ADDRESS, ESCROW_ADDRESS } from '@/lib/contracts'

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

interface TerminalLine {
  text: string
  delay: number
  color?: 'muted' | 'gold' | 'teal' | 'default'
}

export function AgentPanel() {
  const { data: agentEns, isLoading: ensLoading } = useEnsName({
    address: AGENT_ADDRESS,
    chainId: mainnet.id,
  })
  const { data: agentAvatar } = useEnsAvatar({
    name: agentEns ?? undefined,
    chainId: mainnet.id,
  })

  const [displayedLines, setDisplayedLines] = useState<{ text: string; color?: string }[]>([])
  const [cursor, setCursor] = useState(true)
  const [ready, setReady] = useState(false)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (ensLoading) return

    const identity = agentEns ?? shortAddr(AGENT_ADDRESS)

    const lines: TerminalLine[] = [
      { text: `> AGENT  ${shortAddr(AGENT_ADDRESS)}`, delay: 0, color: 'muted' },
      { text: `> RESOLVING ENS...`, delay: 600, color: 'muted' },
      { text: `> IDENTIFIED: ${identity}`, delay: 1400, color: 'gold' },
      { text: `> ESCROW  ${shortAddr(ESCROW_ADDRESS)}  [BASE MAINNET]`, delay: 2000, color: 'muted' },
      { text: `> FEE     0.3% of swap output`, delay: 2500, color: 'muted' },
      { text: `> STATUS  ACCEPTING INTENTS`, delay: 3000, color: 'teal' },
    ]

    let cumulativeDelay = 0

    lines.forEach((line, lineIdx) => {
      const lineStart = line.delay
      for (let charIdx = 0; charIdx <= line.text.length; charIdx++) {
        const t = setTimeout(() => {
          setDisplayedLines(prev => {
            const next = [...prev]
            if (!next[lineIdx]) {
              next[lineIdx] = { text: '', color: line.color }
            }
            next[lineIdx] = { text: line.text.slice(0, charIdx), color: line.color }
            return next
          })
        }, lineStart + charIdx * 18)
        timeoutsRef.current.push(t)
      }
      cumulativeDelay = lineStart + line.text.length * 18
    })

    const doneTimer = setTimeout(() => setReady(true), cumulativeDelay + 200)
    timeoutsRef.current.push(doneTimer)

    return () => {
      timeoutsRef.current.forEach(clearTimeout)
      timeoutsRef.current = []
    }
  }, [ensLoading, agentEns])

  // Blinking cursor
  useEffect(() => {
    const interval = setInterval(() => setCursor(c => !c), 550)
    return () => clearInterval(interval)
  }, [])

  const colorClass = (color?: string) => {
    if (color === 'gold') return 'text-gold'
    if (color === 'teal') return 'text-teal'
    if (color === 'muted') return 'text-ink-muted'
    return 'text-ink'
  }

  return (
    <div className="w-full border border-border bg-card relative overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-ink-faint label">agent terminal</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-teal animate-pulse-soft' : 'bg-gold animate-pulse-soft'}`} />
          <span className="label text-ink-muted">{ready ? 'ONLINE' : 'CONNECTING'}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_auto] gap-0">
        {/* Terminal output */}
        <div className="px-5 py-5 font-mono text-xs space-y-1 min-h-[180px]">
          {displayedLines.map((line, i) => (
            <div key={i} className={`${colorClass(line.color)} leading-relaxed`}>
              {line.text}
              {i === displayedLines.length - 1 && (
                <span className={`inline-block w-[7px] h-[13px] bg-current ml-0.5 align-text-bottom ${cursor ? 'opacity-100' : 'opacity-0'}`} />
              )}
            </div>
          ))}
          {displayedLines.length === 0 && (
            <div className="text-ink-muted">
              {`> `}
              <span className={`inline-block w-[7px] h-[13px] bg-ink-muted ml-0.5 align-text-bottom ${cursor ? 'opacity-100' : 'opacity-0'}`} />
            </div>
          )}
        </div>

        {/* Agent avatar + identity (shown once ready) */}
        {ready && (
          <div className="border-l border-border px-6 py-5 flex flex-col items-center justify-center gap-3 animate-fade-in min-w-[160px]">
            <div className="w-14 h-14 border border-gold relative overflow-hidden bg-elevated">
              {agentAvatar ? (
                <Image src={agentAvatar} alt="Agent avatar" fill className="object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <rect x="6" y="4" width="16" height="12" rx="2" stroke="#c9a94e" strokeWidth="1.5" />
                    <rect x="11" y="16" width="6" height="6" stroke="#c9a94e" strokeWidth="1.5" />
                    <rect x="4" y="22" width="20" height="2" fill="#c9a94e" fillOpacity="0.3" />
                    <circle cx="10" cy="10" r="1.5" fill="#c9a94e" />
                    <circle cx="18" cy="10" r="1.5" fill="#c9a94e" />
                  </svg>
                </div>
              )}
            </div>
            <div className="text-center">
              {agentEns ? (
                <p className="text-gold font-mono text-xs font-bold">{agentEns}</p>
              ) : (
                <p className="text-ink-muted font-mono text-xs">{shortAddr(AGENT_ADDRESS)}</p>
              )}
              <p className="text-ink-faint text-xs mt-0.5">agent</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom metadata bar */}
      <div className="border-t border-border px-5 py-2.5 flex gap-6 flex-wrap">
        <div className="flex gap-2 items-center">
          <span className="label">escrow</span>
          <a
            href={`https://base.blockscout.com/address/${ESCROW_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-muted text-xs hover:text-gold transition-colors font-mono"
          >
            {shortAddr(ESCROW_ADDRESS)} ↗
          </a>
        </div>
        <div className="flex gap-2 items-center">
          <span className="label">chain</span>
          <span className="text-ink-muted text-xs">Base Mainnet · 8453</span>
        </div>
        <div className="flex gap-2 items-center">
          <span className="label">routing</span>
          <span className="text-ink-muted text-xs">Uniswap · CLASSIC</span>
        </div>
      </div>
    </div>
  )
}
