import { NextRequest, NextResponse } from 'next/server'

const UNISWAP_API = 'https://trade-api.gateway.uniswap.org/v1'

export async function POST(req: NextRequest) {
  const apiKey = process.env.UNISWAP_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'UNISWAP_API_KEY not configured' }, { status: 500 })
  }

  const body = await req.json()

  const res = await fetch(`${UNISWAP_API}/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-universal-router-version': '2.0',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
