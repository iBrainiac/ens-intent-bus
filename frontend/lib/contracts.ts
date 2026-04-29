import { parseAbi } from 'viem'

export const ESCROW_ADDRESS = '0x2a7f100C6955a92785b886d2c33aa1F4C8339de2' as const
export const AGENT_ADDRESS = '0xd9477E7ECD1fad7864095C40965c1e99dE01F308' as const
export const DEPLOYMENT_BLOCK = 45340440n

export const WETH = {
  address: '0x4200000000000000000000000000000000000006' as const,
  symbol: 'WETH',
  decimals: 18,
  name: 'Wrapped Ether',
}

export const USDC = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
}

export const TOKEN_PAIRS = [
  { tokenIn: WETH, tokenOut: USDC, label: 'WETH → USDC' },
  { tokenIn: USDC, tokenOut: WETH, label: 'USDC → WETH' },
] as const

export const ESCROW_ABI = parseAbi([
  'function deposit(bytes32 ensNode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 expiry) external returns (uint256)',
  'function cancel(uint256 intentId) external',
  'function getIntent(uint256 intentId) external view returns (address user, bytes32 ensNode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 expiry, uint8 status)',
  'function nextIntentId() external view returns (uint256)',
  'event IntentCreated(uint256 indexed intentId, address indexed user, bytes32 ensNode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 expiry)',
  'event IntentExecuted(uint256 indexed intentId, address indexed agent, uint256 amountOut, uint256 agentFee)',
  'event IntentCancelled(uint256 indexed intentId)',
])

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
])

export const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const
export const ENS_REGISTRY_ABI = parseAbi([
  'function resolver(bytes32 node) external view returns (address)',
])

export const ENS_RESOLVER_ABI = parseAbi([
  'function setText(bytes32 node, string calldata key, string calldata value) external',
])

export const ENS_INTENT_KEY = 'uni-ens.intent'

export const INTENT_STATUS = {
  0: 'PENDING',
  1: 'EXECUTED',
  2: 'CANCELLED',
} as const
