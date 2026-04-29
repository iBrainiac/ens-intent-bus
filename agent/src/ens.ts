import { createPublicClient, http, namehash } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.MAINNET_RPC_URL),
});

export const ENS_INTENT_KEY = "uni-ens.intent";

/// Returns the intentId stored in the user's ENS text record, or null if not set.
export async function getIntentTextRecord(ensName: string): Promise<string | null> {
  const value = await client.getEnsText({ name: ensName, key: ENS_INTENT_KEY });
  return value ?? null;
}

/// Verifies that the ENS name resolves to the given address (reverse check).
export async function verifyEnsOwner(ensName: string, expectedAddress: string): Promise<boolean> {
  const resolved = await client.getEnsAddress({ name: ensName });
  return resolved?.toLowerCase() === expectedAddress.toLowerCase();
}

export { namehash };
export { client as ensClient };
