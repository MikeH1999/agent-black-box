import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SealedTraceCapsule } from "@/lib/agent/workflow";
import type { JsonUploadLifecycleEvent } from "@/lib/filecoin/json-storage";

export type StoredRunLog = {
  runId: string;
  task: string;
  finalAnswer: string;
  createdAt: string;
  finalPieceCid: string | null;
  capsules: Array<{
    stepType: string;
    pieceCid: string;
    previousPieceCid: string | null;
    size: number;
    complete: boolean | undefined;
    requestedCopies: number | undefined;
    copies: SealedTraceCapsule["receipt"]["copies"];
    failedAttempts: SealedTraceCapsule["receipt"]["failedAttempts"];
  }>;
  onchainEvents: Array<{
    stepType: string;
    event: JsonUploadLifecycleEvent;
  }>;
};

const outputDir = join(process.cwd(), "outputs");
const runLogPath = join(outputDir, "run-log.ndjson");

export async function appendRunLog(input: {
  runId: string;
  task: string;
  finalAnswer: string;
  sealedCapsules: SealedTraceCapsule[];
  onchainEvents?: StoredRunLog["onchainEvents"];
}) {
  await mkdir(outputDir, { recursive: true });

  const entry: StoredRunLog = {
    runId: input.runId,
    task: input.task,
    finalAnswer: input.finalAnswer,
    createdAt: new Date().toISOString(),
    finalPieceCid: input.sealedCapsules.at(-1)?.receipt.pieceCid ?? null,
    capsules: input.sealedCapsules.map((item) => ({
      stepType: item.capsule.stepType,
      pieceCid: item.receipt.pieceCid,
      previousPieceCid: item.capsule.previousPieceCid,
      size: item.receipt.size,
      complete: item.receipt.complete,
      requestedCopies: item.receipt.requestedCopies,
      copies: item.receipt.copies,
      failedAttempts: item.receipt.failedAttempts
    })),
    onchainEvents: input.onchainEvents ?? []
  };

  await appendFile(runLogPath, `${JSON.stringify(entry)}\n`, "utf8");

  return entry;
}

export async function readRecentRunLogs(limit = 5): Promise<StoredRunLog[]> {
  try {
    const text = await readFile(runLogPath, "utf8");
    const entries = text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as StoredRunLog);

    return entries.slice(-limit).reverse();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
