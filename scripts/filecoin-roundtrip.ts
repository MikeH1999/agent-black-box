import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { createSynapseClient } from "@/lib/filecoin/client";
import { downloadJsonPayload, uploadJsonPayload } from "@/lib/filecoin/json-storage";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

async function main() {
  console.log("Running Filecoin JSON round trip...");

  const synapse = await createSynapseClient();
  const payload = {
    capsuleVersion: "roundtrip-1",
    type: "trace_capsule_roundtrip",
    taskId: crypto.randomUUID(),
    stepType: "environment_check",
    message: "This JSON document proves that Agent Black Box can store and restore agent trace data via FOC.",
    createdAt: new Date().toISOString(),
    padding: "FOC minimum upload size requires this payload to be comfortably larger than 127 bytes."
  };

  const upload = await uploadJsonPayload(synapse, payload, {
    app: "agent-black-box",
    purpose: "roundtrip"
  });

  console.log(`Uploaded JSON payload: ${upload.size} bytes`);
  console.log(`PieceCID: ${upload.pieceCid}`);
  console.log(`Complete: ${upload.complete}`);
  console.log(`Requested copies: ${upload.requestedCopies}`);
  console.log(`Stored copies: ${upload.copies.length}`);
  for (const copy of upload.copies) {
    console.log(`  - provider #${copy.providerId}, dataSet #${copy.dataSetId}, piece #${copy.pieceId}, role ${copy.role}`);
  }
  for (const attempt of upload.failedAttempts) {
    console.log(`Failed copy attempt: provider #${attempt.providerId}, role ${attempt.role}, ${attempt.error}`);
  }

  const restored = await downloadJsonPayload(synapse, upload.pieceCid);

  assert.deepEqual(restored.value, payload);
  console.log(`Downloaded JSON payload: ${restored.size} bytes`);
  console.log("Round trip verified: downloaded JSON matches uploaded JSON.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Filecoin JSON round trip failed.");
  console.error(message);
  process.exit(1);
});
