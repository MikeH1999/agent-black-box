import nextEnv from "@next/env";
import { createSynapseClient } from "@/lib/filecoin/client";
import { prepareStorageForBytes } from "@/lib/filecoin/prepare";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

async function main() {
  const dataSize = BigInt(process.argv[2] ?? "1024");
  console.log(`Preparing Filecoin storage for ${dataSize.toString()} bytes...`);

  const synapse = await createSynapseClient();
  const result = await prepareStorageForBytes(synapse, dataSize);

  console.log(`Ready: ${result.ready}`);
  console.log(`Deposit needed: ${result.depositNeeded}`);
  console.log(`Needs FWSS max approval: ${result.needsFwssMaxApproval}`);

  if (result.transaction == null) {
    console.log("No preparation transaction required.");
    return;
  }

  console.log(`Preparation transaction hash: ${result.transaction.hash}`);
  console.log(`Preparation receipt status: ${result.transaction.receipt?.status ?? "unknown"}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Filecoin storage preparation failed.");
  console.error(message);
  process.exit(1);
});
