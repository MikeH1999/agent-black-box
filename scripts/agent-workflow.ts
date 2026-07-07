import nextEnv from "@next/env";
import { runFixedAgentWorkflow } from "@/lib/agent/workflow";
import { createSynapseClient } from "@/lib/filecoin/client";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

async function main() {
  const task =
    process.argv.slice(2).join(" ") ||
    "Evaluate whether Agent Black Box is a strong Filecoin hackathon project idea.";

  console.log(`Running fixed agent workflow for task: ${task}`);

  const synapse = await createSynapseClient();
  const result = await runFixedAgentWorkflow(synapse, task);

  console.log(`Final answer: ${result.finalAnswer}`);
  console.log(`Trace capsules sealed: ${result.sealedCapsules.length}`);
  for (const sealed of result.sealedCapsules) {
    console.log(`  - ${sealed.capsule.stepType}: ${sealed.receipt.pieceCid}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Agent workflow failed.");
  console.error(message);
  process.exit(1);
});
