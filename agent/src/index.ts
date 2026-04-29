import "dotenv/config";
import { publicClient, escrowAddress, ESCROW_ABI, processIntent } from "./executor.js";
import { ensClient } from "./ens.js";

// ENS name registry: maps intentId → ensName
// In production this would be stored or passed via the IntentCreated event's ensNode + an off-chain lookup.
// For the demo, agents can be seeded with a list of watched ENS names.
const watchedNames: Record<string, string> = {};

async function resolveAgentIdentity(address: `0x${string}`): Promise<void> {
  const agentEns = await ensClient.getEnsName({ address }).catch(() => null);
  if (agentEns) {
    const avatar = await ensClient.getEnsAvatar({ name: agentEns }).catch(() => null);
    console.log(`[agent] Identity: ${agentEns} (${address})`);
    if (avatar) console.log(`[agent] Avatar:   ${avatar}`);
  } else {
    console.log(`[agent] Identity: ${address} (no ENS name — set a primary ENS name on this wallet for discoverability)`);
  }
}

async function main() {
  const { account } = await import("./executor.js");
  await resolveAgentIdentity(account.address);
  console.log(`[agent] Watching escrow: ${escrowAddress}`);

  // Watch for new IntentCreated events
  publicClient.watchContractEvent({
    address: escrowAddress,
    abi: ESCROW_ABI,
    eventName: "IntentCreated",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { intentId, user } = log.args as { intentId: bigint; user: string };
        console.log(`[agent] New intent detected: ${intentId} from ${user}`);

        // Resolve the user's primary ENS name so we can verify their text record
        const ensName = await ensClient.getEnsName({ address: user as `0x${string}` });
        if (!ensName) {
          console.log(`[agent] No primary ENS name for ${user}. Cannot verify intent. Skipping.`);
          continue;
        }

        watchedNames[intentId.toString()] = ensName;
        await processIntent(intentId, ensName).catch((err) => {
          console.error(`[agent] Failed to process intent ${intentId}:`, err);
        });
      }
    },
  });

  console.log("[agent] Listening for IntentCreated events...");
}

main().catch((err) => {
  console.error("[agent] Fatal error:", err);
  process.exit(1);
});
