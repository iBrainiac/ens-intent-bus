import { isAddress, isHex, type Address, type Hex } from "viem";

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt === maxRetries) return res;
    const delay = Math.min(200 * Math.pow(2, attempt) + Math.random() * 100, 10_000);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error("fetchWithRetry: unreachable");
}

const REQUIRED_HEADERS = {
  "Content-Type": "application/json",
  "x-universal-router-version": "2.0",
};

export interface SwapData {
  /// Universal Router calldata to forward to escrow.execute()
  calldata: Hex;
  /// Universal Router address that the calldata targets — must match escrow's UNISWAP_ROUTER
  to: Address;
  /// ETH value (always "0" for ERC20→ERC20 swaps)
  value: bigint;
  /// Best-case output amount from the quote
  amountOut: bigint;
}

interface ClassicQuoteResponse {
  routing: "CLASSIC" | "WRAP" | "UNWRAP";
  quote: { output: { token: string; amount: string } };
  permitData?: Record<string, unknown> | null;
  permitTransaction?: Record<string, unknown> | null;
}

interface UniswapXQuoteResponse {
  routing: "DUTCH_V2" | "DUTCH_V3" | "PRIORITY";
  quote: { orderInfo: { outputs: Array<{ startAmount: string }> } };
  permitData?: Record<string, unknown> | null;
  permitTransaction?: Record<string, unknown> | null;
}

type QuoteResponse = ClassicQuoteResponse | UniswapXQuoteResponse;

interface SwapResponse {
  swap: { to: string; from: string; data: string; value: string };
}

function assertClassicQuote(q: QuoteResponse): asserts q is ClassicQuoteResponse {
  if (q.routing === "DUTCH_V2" || q.routing === "DUTCH_V3" || q.routing === "PRIORITY") {
    throw new Error(`Unexpected routing type: ${q.routing} — only CLASSIC supported for on-chain escrow execution`);
  }
}

/// Two-step Trading API flow: /quote → /swap.
/// Forces CLASSIC routing because UniswapX (DUTCH_*/PRIORITY) routes through off-chain
/// fillers, which doesn't work for our on-chain escrow execution.
export async function getSwapCalldata(params: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  swapper: Address; // escrow contract address
  chainId: number;
  slippagePercent?: number;
}): Promise<SwapData> {
  const { tokenIn, tokenOut, amountIn, swapper, chainId, slippagePercent = 0.5 } = params;

  if (!isAddress(tokenIn) || !isAddress(tokenOut) || !isAddress(swapper)) {
    throw new Error("Invalid address in swap params");
  }

  const apiKey = process.env.UNISWAP_API_KEY;
  if (!apiKey) throw new Error("UNISWAP_API_KEY env var is required");

  const headers = { ...REQUIRED_HEADERS, "x-api-key": apiKey };

  // Step 1: /quote
  const quoteRes = await fetchWithRetry(`${UNISWAP_API_BASE}/quote`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      swapper,
      tokenIn,
      tokenOut,
      tokenInChainId: String(chainId),
      tokenOutChainId: String(chainId),
      amount: amountIn.toString(),
      type: "EXACT_INPUT",
      slippageTolerance: slippagePercent,
      routingPreference: "CLASSIC",
    }),
  });

  if (!quoteRes.ok) {
    throw new Error(`Quote failed ${quoteRes.status}: ${await quoteRes.text()}`);
  }

  const quoteResponse = (await quoteRes.json()) as QuoteResponse;

  assertClassicQuote(quoteResponse);
  const amountOut = BigInt(quoteResponse.quote.output.amount);

  // Step 2: /swap — strip null permit fields, spread the rest
  const { permitData, permitTransaction, ...cleanQuote } = quoteResponse;
  void permitData;
  void permitTransaction;

  const swapRes = await fetchWithRetry(`${UNISWAP_API_BASE}/swap`, {
    method: "POST",
    headers,
    body: JSON.stringify(cleanQuote),
  });

  if (!swapRes.ok) {
    throw new Error(`Swap call failed ${swapRes.status}: ${await swapRes.text()}`);
  }

  const swapData = (await swapRes.json()) as SwapResponse;

  // Validate before returning
  if (!swapData.swap?.data || swapData.swap.data === "0x" || !isHex(swapData.swap.data)) {
    throw new Error("Empty or invalid swap.data — quote may have expired");
  }
  if (!isAddress(swapData.swap.to)) {
    throw new Error("Invalid swap.to address");
  }

  return {
    calldata: swapData.swap.data,
    to: swapData.swap.to,
    value: BigInt(swapData.swap.value || "0"),
    amountOut,
  };
}
