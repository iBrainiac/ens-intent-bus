# ens-intent-bus — Intent-Based Swaps, Signed by Your ENS Name

> Trade by publishing your intent onchain. An AI agent reads your ENS, verifies your identity, and executes the best swap via Uniswap — trustlessly.

---

## The Idea

Most swap interfaces require the user to be online, approve transactions in real time, and trust the UI they're looking at. uni-ens flips this model.

A user publishes a trade intent by writing a single text record to their ENS name — the same ENS name that represents their identity across all of web3. They deposit tokens into a smart contract escrow and walk away. An AI agent monitors the chain, reads the ENS record, verifies the user's identity through ENS ownership, fetches the best execution from the Uniswap Trading API, and completes the swap on their behalf.

**ENS is not a UI decoration here. It is the authorization mechanism.** The agent will not touch a deposit unless the ENS name linked to the intent resolves to the depositing wallet. Spoof the name, and nothing happens. Set the wrong record, and nothing happens. Only the real ENS owner can authorize execution.

---

## How It Works

```
User                          ENS (L1)                    IntentEscrow (Base)           Agent
 │                               │                               │                         │
 ├─ set text record ────────────▶│                               │                         │
 │  "uni-ens.intent" = "42"      │                               │                         │
 │                               │                               │                         │
 ├─ deposit(ensNode, WETH, USDC, amountIn, minOut, expiry) ─────▶│                         │
 │                               │                               │──IntentCreated event ──▶│
 │                               │                               │                         │
 │                               │◀── reverse resolve user ──────│─────────────────────────┤
 │                               │    address → alice.eth        │                         │
 │                               │                               │                         │
 │                               │◀── read text record ──────────│─────────────────────────┤
 │                               │    "uni-ens.intent" == "42"?  │                         │
 │                               │                               │                         │
 │                               │◀── forward resolve ───────────│─────────────────────────┤
 │                               │    alice.eth → user address?  │                         │
 │                               │                               │                         │
 │                        [all checks pass]                      │                         │
 │                               │                               │                         │
 │                               │         Uniswap Trading API ◀─│─────────────────────────┤
 │                               │         /quote + /swap        │                         │
 │                               │                               │                         │
 │                               │                               │◀── execute(42, calldata)─┤
 │                               │                               │    swap WETH → USDC      │
 │◀─ receive USDC ───────────────│───────────────────────────────┤                         │
 │◀─ agent earns 0.3% fee ───────│───────────────────────────────│────────────────────────▶│
```

### The Three-Layer Identity Check

Before executing any swap, the agent runs three sequential ENS verifications:

1. **Reverse resolution** — resolves the depositing wallet address to an ENS name. No ENS name, no execution.
2. **Text record match** — reads the `uni-ens.intent` text record on that ENS name. The value must exactly match the on-chain intent ID.
3. **Forward resolution** — resolves the ENS name back to an address and checks it matches the depositor. Prevents subdomain hijacking.

All three must pass. This makes ENS ownership the cryptographic key that authorizes the AI agent to act.

---

## Why This Is a New Primitive

**ENS text records as an intent channel.** Today ENS text records store things like Twitter handles, email addresses, and website URLs. uni-ens uses them to store *machine-readable trade intentions* — structured data that an AI agent can read, verify, and act on.

This means:
- A user can express a future trade intent from any device, any UI, at any time — by updating a single ENS record
- The intent is tied to their web3 identity, not a session or a connection
- Agents can discover and serve users by reading ENS — no API, no account, no login
- The model generalizes: any AI agent can read ENS to understand what a user needs

**The agent has its own ENS identity.** At startup, the agent resolves its own wallet address to its ENS name, displays it (with avatar), and announces its identity. This means agents are discoverable by name, not just by address. Multiple competing agents can serve the same users — users pick the one they trust by name.

---

## Architecture

```
uni-ens/
├── contracts/               Solidity — Foundry
│   └── src/
│       └── IntentEscrow.sol     Escrow + swap executor
│   └── test/
│       ├── IntentEscrow.t.sol       Unit tests
│       └── IntentEscrowFork.t.sol   Fork tests against live Base mainnet
│   └── script/
│       └── Deploy.s.sol
│
└── agent/                   TypeScript — Node.js
    └── src/
        ├── index.ts             Event listener + agent identity resolution
        ├── executor.ts          Intent processing pipeline
        ├── ens.ts               ENS resolution (Ethereum mainnet)
        └── uniswap.ts           Uniswap Trading API client
```

### IntentEscrow.sol

A non-upgradeable escrow contract on Base mainnet. Holds user tokens and enforces the swap rules:

- `deposit()` — user locks tokens with their ENS namehash, token pair, minimum output, and expiry
- `execute()` — agent calls this with Uniswap Trading API calldata; contract pre-transfers tokens to the Universal Router, calls it, and distributes output
- `cancel()` — user reclaims their tokens at any time if unexecuted

Key security properties:
- `ReentrancyGuard` on all state-changing functions
- Checks-Effects-Interactions: intent status flipped to `Executed` before any external call
- `SafeERC20` for all token transfers
- Hard slippage enforcement: reverts if `amountOut < minAmountOut`
- Router address verified on-chain: the calldata's target must match `UNISWAP_ROUTER`

### Agent

A stateless TypeScript process that:

1. Resolves its own ENS identity at startup (agent is a first-class ENS citizen)
2. Watches `IntentCreated` events on Base via viem
3. Reverse-resolves each depositor's address to their ENS name (via Ethereum mainnet)
4. Runs the three-layer ENS identity verification
5. Calls the Uniswap Trading API (`/quote` → `/swap`) with `routingPreference: "CLASSIC"` — forces on-chain AMM routing since the escrow's pre-transfer model is incompatible with off-chain UniswapX fillers
6. Verifies the API's target router address matches the deployed escrow's `UNISWAP_ROUTER`
7. Simulates the transaction locally before broadcasting to surface reverts before spending gas
8. Broadcasts and earns a 0.3% fee on the output

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contract | Solidity 0.8.24, Foundry |
| Chain | Base Mainnet (chain ID 8453) |
| DEX router | Uniswap Universal Router v2 (`0x6fF5693b99212Da76ad316178A184AB56D299b43`) |
| Swap routing | Uniswap Trading API — `/quote` + `/swap` |
| Identity | ENS — text records, reverse resolution, forward resolution |
| Agent runtime | Node.js + TypeScript |
| Blockchain client | viem (dual-chain: Base for escrow, Ethereum mainnet for ENS) |
| Contract verification | Blockscout (no API key required) |

---

## ENS Integration — What ENS Is Actually Doing

ENS is not cosmetic in this project. It performs three distinct jobs:

| Job | ENS Function Used | Why It Matters |
|-----|------------------|----------------|
| Intent signaling | `setText` / `getEnsText` (key: `uni-ens.intent`) | User publishes intent without interacting with the escrow contract |
| Identity verification | `getEnsAddress` (forward resolve) | Confirms ENS name owner is the depositor — prevents spoofing |
| User discovery | `getEnsName` (reverse resolve) | Agent discovers user's ENS name from their wallet address |
| Agent identity | `getEnsName` on agent address + `getEnsAvatar` | Agent announces itself as a named, discoverable entity |

The ENS `ensNode` (namehash) is stored on-chain inside the `Intent` struct. This creates a permanent, auditable link between the swap and the ENS identity that authorized it.

---

## Uniswap Integration — What the Trading API Is Doing

The agent uses the Uniswap Trading API as its sole source of swap calldata:

```
POST /quote  →  gets executable quote with CLASSIC routing on Base
POST /swap   →  gets signed calldata for the Universal Router
```

The calldata is passed unmodified into `IntentEscrow.execute()`, which forwards it to the Universal Router. This means:

- Routing optimization is delegated entirely to Uniswap's infrastructure
- The escrow contract has no opinion on routing — it just enforces the minimum output
- Any token pair supported by Uniswap on Base is automatically supported

**Why CLASSIC routing?** The escrow pre-transfers tokens to the Universal Router before calling it (`payerIsUser: false`). UniswapX routes through off-chain fillers who pull tokens from the user via Permit2 — a model that doesn't work when the "user" is a smart contract holding tokens in escrow. CLASSIC routing forces on-chain AMM execution, which works with the pre-transfer pattern.

---

## Fork Test Results

Validated against live Base mainnet before deployment:

```
forge test --match-contract IntentEscrowForkTest -vv --fork-url https://mainnet.base.org

[PASS] test_executeSwapWethToUsdc()
  WETH in        : 10000000000000000   (0.01 WETH)
  USDC total out : 22913409            (~$22.91)
  User received  : 22844669            (99.7%)
  Agent fee      : 68740               (0.3%)

[PASS] test_executeRevertsWhenSlippageExceeded()
[PASS] test_cannotExecuteTwice()
```

All three pass against the real Universal Router with real pool liquidity.

---

## Network

| Property | Value |
|----------|-------|
| Chain | Base Mainnet |
| Chain ID | 8453 |
| RPC | https://mainnet.base.org |
| Explorer | https://base.blockscout.com |
| Universal Router | `0x6fF5693b99212Da76ad316178A184AB56D299b43` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

## Setup

### Prerequisites

- Foundry (`forge --version`)
- Node.js 20+
- A wallet with Base ETH (~$0.05 for deployment)
- Uniswap Trading API key ([developers.uniswap.org](https://developers.uniswap.org))

### Deploy the Contract

```bash
cd contracts

# Create .env
cp .env.example .env   # fill in PRIVATE_KEY, BASE_RPC_URL, UNIVERSAL_ROUTER

source .env

forge script script/Deploy.s.sol \
  --rpc-url $BASE_RPC_URL \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url https://base.blockscout.com/api \
  --chain 8453 \
  -vvv
```

Copy the deployed `IntentEscrow` address from the output.

### Run the Agent

```bash
cd agent
npm install

# Create .env
cat > .env << EOF
AGENT_PRIVATE_KEY=0x...
ESCROW_ADDRESS=0x...         # from deploy step
BASE_RPC_URL=https://mainnet.base.org
MAINNET_RPC_URL=https://eth.llamarpc.com
UNISWAP_API_KEY=...
EOF

npm start
```

The agent will print its ENS identity (if the agent wallet has a primary ENS name set) and begin listening for intents.

### Create an Intent (User Side)

1. Set your ENS text record — key: `uni-ens.intent`, value: `<intentId>` (set to `0` before depositing, update after)
2. Approve the escrow contract to spend your `tokenIn`
3. Call `deposit(ensNode, tokenIn, tokenOut, amountIn, minAmountOut, expiry)`
4. Update your ENS text record to the returned `intentId`

The agent picks it up automatically from the `IntentCreated` event.

---

## Agent Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_PRIVATE_KEY` | Yes | Agent wallet private key (earns 0.3% fees) |
| `ESCROW_ADDRESS` | Yes | Deployed IntentEscrow contract address |
| `BASE_RPC_URL` | Yes | Base mainnet RPC (used for contract calls) |
| `MAINNET_RPC_URL` | Yes | Ethereum mainnet RPC (used for ENS resolution only) |
| `UNISWAP_API_KEY` | Yes | Uniswap Trading API key |

---

## What's Next

- **Frontend** — a UI for users to set their ENS intent record and approve tokens without touching raw contract calls
- **Multi-agent competition** — multiple named agents competing to execute the same intent pool; user can filter by agent ENS reputation
- **ENS text record as limit order** — extend the intent format to support price conditions, expiry strategies, and partial fills encoded in ENS records
- **Agent registry via ENS subnames** — `agent1.uni-ens.eth`, `agent2.uni-ens.eth` — agents discoverable as subnames of a parent ENS namespace
