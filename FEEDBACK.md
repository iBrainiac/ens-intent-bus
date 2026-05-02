# Uniswap Trading API — Builder Feedback

## Project

**uni-ens**: Intent-based swap escrow on Base. Users publish trade intents via ENS text records and deposit tokens into a smart contract. An off-chain agent monitors ENS, verifies the intent, fetches swap calldata from the Uniswap Trading API, and executes the swap via the Universal Router.

---

## What Worked Well

- **Two-step `/quote` → `/swap` flow** was straightforward to implement. The separation between getting a quote and getting executable calldata is clean.
- **`routingPreference: "CLASSIC"`** forced on-chain AMM routing, which was exactly what we needed — our escrow contract pre-transfers tokens to the Universal Router and calls it directly, so off-chain fillers (UniswapX) cannot work in this setup. Having an explicit override for this was essential.
- **`x-universal-router-version: 2.0` header** is well-documented and the v4 Universal Router address for Base (`0x6fF5693b99212Da76ad316178A184AB56D299b43`) works correctly.
- **Exponential backoff on 429s** — rate limits are reasonable and retries resolve them cleanly.
- **Calldata quality** — the swap calldata from `/swap` worked against the real Universal Router in fork tests without modification. No encoding surprises.

---

## What Didn't Work / Pain Points

- **No `/check_approval` equivalent for contract-held tokens** — the approval flow assumes a user wallet with Permit2. When tokens are held by a smart contract (our escrow), the approval model is entirely different (pre-transfer to router, `payerIsUser: false`). This isn't documented for the contract-as-swapper case. We had to figure out the pre-transfer pattern from the Universal Router source.

- **`MSG_SENDER` (`0x0000...0001`) recipient convention is underdocumented** — this magic address resolves to the caller of `execute()` inside the Universal Router. We needed this so output tokens return to our escrow contract. It's mentioned briefly in the SDK but not in the Trading API docs for the calldata it generates.

- **CORS on browser** — the Trading API does not support browser-origin requests (OPTIONS preflight returns 415). This means any frontend using the API must proxy through a server. This should be a top-level warning in the docs, not something discovered at integration time.

- **Quote shape differs by routing type with no discriminated type exported** — the `quote` object has different fields for CLASSIC vs UniswapX responses (`quote.output.amount` vs `quote.orderInfo.outputs[0].startAmount`). The SDK has TypeScript types for this but they aren't exported in a form that's easy to use without pulling in the entire SDK.

- **`tokenInChainId` / `tokenOutChainId` must be strings** — the API accepts these as strings despite being chain IDs (integers). This is inconsistent with `chainId` in `/check_approval` which accepts an integer. Caused a silent 400 during early testing.

---

## Bugs Hit

- Forcing `routingPreference: "CLASSIC"` on Base still occasionally returned routing type `"WRAP"` when the input token was WETH. This is technically correct (WETH→WETH is a no-op wrap) but the quote response shape is identical to CLASSIC and the agent handled it correctly — just unexpected.

---

## Docs Gaps

- The contract-as-swapper pattern (escrow holds tokens, pre-transfers to router, `payerIsUser: false`) is not documented anywhere in the Trading API docs. Developers building DeFi primitives on top of the Trading API need this.
- No documentation on which routing types are available per chain. We knew PRIORITY exists on Base but had to test to confirm CLASSIC was still available when forced.
- The `x-universal-router-version` header requirement is easy to miss — it should be in the authentication section, not buried in examples.

---

## Missing Endpoints / Features

- **Agent/contract quote endpoint** — a variant of `/quote` that accepts a contract address as `swapper` and skips Permit2 entirely, returning calldata formatted for `payerIsUser: false`. This would remove the need to reverse-engineer the pre-transfer pattern.
- **Webhook or event push for quote expiry** — quotes expire in ~30 seconds. For agent-based systems that poll on-chain events, it would help to have a way to subscribe to intent updates rather than polling.

---

## AI-Powered Intent Interface (OpenAI + Trading API)

We built two interfaces for interacting with the system — a **manual mode** (step-by-step form with token selector, amount input, and flexible expiry) and a **chat mode** (OpenAI GPT-4o conversational interface) — togglable via a single CHAT / MANUAL switch in the UI. Both modes drive the same 3-transaction flow under the hood.

The chat mode wraps the Trading API integration to let users create, check, and cancel swap intents in plain English.

**Architecture:**
- User types a message (e.g. *"swap 5 USDC to WETH in 30 minutes"*)
- A Next.js API route proxies the message to GPT-4o with three function tools: `create_intent`, `get_status`, `cancel_intent`
- The system prompt is injected with the user's ENS name, wallet address, and current on-chain intent state fetched live from Base
- When GPT-4o calls `create_intent`, the frontend parses the structured args and drives a 3-transaction flow: ENS text record (Mainnet) → ERC20 approval (Base) → escrow deposit (Base)

**Why this worked well with the Trading API:**
- The AI extracts clean `tokenIn`, `tokenOut`, `amount`, and `expiryMinutes` — these map directly to the Trading API `/quote` parameters without any string parsing in application code
- GPT-4o never calls the Trading API directly; it only produces structured intent parameters. The actual quote fetch happens server-side right before the deposit transaction, ensuring the quote is fresh and not expired
- The 0.5% slippage tolerance used for `minAmountOut` was derived from the quote's `output.amount` — the AI doesn't need to know about slippage at all

**What would help:**
- A natural language → swap calldata shortcut in the Trading API would remove the quote-then-swap two-step from AI agent pipelines where the user only speaks to the agent, not a frontend
- Typed error codes from `/swap` would make it easier for the AI to generate user-friendly retry messages (currently we parse raw error strings)

---

## DX Friction

- Getting an API key requires registering on the developer portal — there's no free tier key for testing . A temporary testing key with rate limits would reduce setup friction significantly.
- The error messages from `/swap` when the quote has expired are generic. A specific `QUOTE_EXPIRED` error code would make retry logic cleaner.
