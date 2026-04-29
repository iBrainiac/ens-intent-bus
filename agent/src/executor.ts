import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  isAddress,
  ContractFunctionExecutionError,
  InsufficientFundsError,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { getIntentTextRecord, verifyEnsOwner } from "./ens.js";
import { getSwapCalldata } from "./uniswap.js";

const ESCROW_ABI = parseAbi([
  "function getIntent(uint256) view returns (address user, bytes32 ensNode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 expiry, uint8 status)",
  "function execute(uint256 intentId, bytes calldata swapData) external",
  "function UNISWAP_ROUTER() view returns (address)",
  "event IntentCreated(uint256 indexed intentId, address indexed user, bytes32 ensNode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint64 expiry)",
]);

const privateKey = process.env.AGENT_PRIVATE_KEY;
if (!privateKey || !privateKey.startsWith("0x")) {
  throw new Error("AGENT_PRIVATE_KEY env var is required (must start with 0x)");
}

const escrowAddressRaw = process.env.ESCROW_ADDRESS;
if (!escrowAddressRaw || !isAddress(escrowAddressRaw)) {
  throw new Error("ESCROW_ADDRESS env var is required and must be a valid address");
}
const escrowAddress = escrowAddressRaw as Address;

const account = privateKeyToAccount(privateKey as `0x${string}`);

const publicClient = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
const walletClient = createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC_URL) });

export async function processIntent(intentId: bigint, ensName: string): Promise<void> {
  console.log(`[agent] Processing intent ${intentId} for ENS name: ${ensName}`);

  // 1. Verify ENS text record matches this intentId
  const textRecord = await getIntentTextRecord(ensName);
  if (textRecord !== intentId.toString()) {
    console.log(`[agent] ENS text record mismatch — expected ${intentId}, got ${textRecord}. Skipping.`);
    return;
  }

  // 2. Read intent state from escrow
  const intent = await publicClient.readContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "getIntent",
    args: [intentId],
  });

  const [user, , tokenIn, tokenOut, amountIn, minAmountOut, expiry, status] = intent;

  if (status !== 0) {
    console.log(`[agent] Intent ${intentId} not pending (status=${status}). Skipping.`);
    return;
  }

  if (BigInt(Math.floor(Date.now() / 1000)) > expiry) {
    console.log(`[agent] Intent ${intentId} expired. Skipping.`);
    return;
  }

  // 3. Verify ENS name resolves to the user
  const ownerVerified = await verifyEnsOwner(ensName, user);
  if (!ownerVerified) {
    console.log(`[agent] ENS ${ensName} does not resolve to ${user}. Skipping.`);
    return;
  }

  // 4. Fetch swap calldata from Uniswap Trading API
  const swap = await getSwapCalldata({
    tokenIn,
    tokenOut,
    amountIn,
    swapper: escrowAddress,
    chainId: base.id,
  });

  // 5. Sanity check: the calldata targets the same router our escrow is configured for
  const escrowRouter = await publicClient.readContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: "UNISWAP_ROUTER",
  });

  if (swap.to.toLowerCase() !== escrowRouter.toLowerCase()) {
    throw new Error(
      `Router mismatch: API targets ${swap.to}, escrow expects ${escrowRouter}. Update escrow deployment.`
    );
  }

  if (swap.amountOut < minAmountOut) {
    console.log(`[agent] Quote ${swap.amountOut} below minAmountOut ${minAmountOut}. Skipping.`);
    return;
  }

  console.log(`[agent] Executing intent ${intentId} — expected out: ${swap.amountOut}`);

  // 6. Simulate first to surface revert reasons before broadcasting
  let request;
  try {
    ({ request } = await publicClient.simulateContract({
      address: escrowAddress,
      abi: ESCROW_ABI,
      functionName: "execute",
      args: [intentId, swap.calldata],
      account,
    }));
  } catch (err) {
    if (err instanceof ContractFunctionExecutionError) {
      console.error(`[agent] Simulation revert for intent ${intentId}: ${err.shortMessage}`);
    } else if (err instanceof InsufficientFundsError) {
      console.error("[agent] Agent wallet has insufficient ETH for gas");
    }
    throw err;
  }

  const hash = await walletClient.writeContract(request);
  console.log(`[agent] Intent ${intentId} executed. Tx: ${hash}`);

  await publicClient.waitForTransactionReceipt({ hash });
}

export { publicClient, escrowAddress, ESCROW_ABI, account };
