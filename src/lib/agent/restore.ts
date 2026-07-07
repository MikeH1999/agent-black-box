import type { Synapse } from "@filoz/synapse-sdk";
import { traceCapsuleSchema, type TraceCapsule } from "@/lib/capsules/schema";
import { downloadJsonPayload } from "@/lib/filecoin/json-storage";

export type RestoredTraceCapsule = {
  pieceCid: string;
  capsule: TraceCapsule;
};

export async function restoreTraceChain(
  synapse: Synapse,
  finalPieceCid: string,
  maxDepth = 20
): Promise<RestoredTraceCapsule[]> {
  const chain: RestoredTraceCapsule[] = [];
  const seen = new Set<string>();
  let currentPieceCid: string | null = finalPieceCid;

  while (currentPieceCid != null) {
    if (seen.has(currentPieceCid)) {
      throw new Error(`Trace chain contains a cycle at PieceCID ${currentPieceCid}`);
    }

    if (chain.length >= maxDepth) {
      throw new Error(`Trace chain exceeded max depth ${maxDepth}`);
    }

    seen.add(currentPieceCid);
    const restored = await downloadJsonPayload(synapse, currentPieceCid);
    const capsule = traceCapsuleSchema.parse(restored.value);

    chain.push({
      pieceCid: currentPieceCid,
      capsule
    });

    currentPieceCid = capsule.previousPieceCid;
  }

  return chain.reverse();
}
