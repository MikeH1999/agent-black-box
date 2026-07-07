import nextEnv from "@next/env";
import { restoreTraceChain } from "@/lib/agent/restore";
import { createSynapseClient } from "@/lib/filecoin/client";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

async function main() {
  const pieceCid = process.argv[2];

  if (pieceCid == null) {
    throw new Error("Usage: npm run restore:trace -- <pieceCid>");
  }

  console.log(`Restoring trace chain from PieceCID: ${pieceCid}`);

  const synapse = await createSynapseClient();
  const restored = await restoreTraceChain(synapse, pieceCid);

  console.log(`Restored capsules: ${restored.length}`);
  for (const item of restored) {
    console.log(`  - ${item.capsule.stepType}: ${item.pieceCid}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Trace restore failed.");
  console.error(message);
  process.exit(1);
});
