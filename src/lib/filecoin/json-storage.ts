import type { Synapse } from "@filoz/synapse-sdk";
import type { Hash } from "viem";
import { prepareStorageForBytes } from "@/lib/filecoin/prepare";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const datasetMetadata = {
  app: "agent-black-box"
};
const configuredProviderIds = selectUploadProviderIds(
  parseProviderIds(process.env.NEXT_PUBLIC_FOC_PROVIDER_IDS ?? (process.env.NEXT_PUBLIC_FILECOIN_NETWORK === "mainnet" ? "" : "9"))
);
const uploadTimeoutMs = parsePositiveInteger(process.env.NEXT_PUBLIC_FOC_UPLOAD_TIMEOUT_MS, 180_000);
const downloadTimeoutMs = parsePositiveInteger(process.env.NEXT_PUBLIC_FOC_DOWNLOAD_TIMEOUT_MS, 60_000);
const chainReceiptTimeoutMs = parsePositiveInteger(process.env.NEXT_PUBLIC_FOC_CHAIN_RECEIPT_TIMEOUT_MS, 60_000);

export type JsonUploadLifecycleEvent =
  | {
      type: "progress";
      bytesUploaded: number;
    }
  | {
      type: "stored";
      providerId: string;
      pieceCid: string;
    }
  | {
      type: "pieces-added";
      transaction: string;
      providerId: string;
      pieces: Array<{ pieceCid: string }>;
    }
  | {
      type: "pieces-confirmed";
      dataSetId: string;
      providerId: string;
      pieces: Array<{ pieceId: string; pieceCid: string }>;
    }
  | {
      type: "copy-complete";
      providerId: string;
      pieceCid: string;
    }
  | {
      type: "copy-failed";
      providerId: string;
      pieceCid: string;
      error: string;
    }
  | {
      type: "pull-progress";
      providerId: string;
      pieceCid: string;
      status: string;
    };

type JsonUploadOptions = {
  onLifecycleEvent?: (event: JsonUploadLifecycleEvent) => void;
  returnAfter?: "complete" | "pieces-added";
  onComplete?: (receipt: JsonUploadReceipt) => void;
  onError?: (error: Error) => void;
};

export type JsonUploadReceipt = {
  pieceCid: string;
  size: number;
  requestedCopies: number;
  complete: boolean;
  chainTransactions: Array<{
    transaction: string;
    providerId: string;
    pieceCid: string;
  }>;
  copies: Array<{
    providerId: string;
    dataSetId: string;
    pieceId: string;
    role: string;
    retrievalUrl: string;
    isNewDataSet: boolean;
  }>;
  failedAttempts: Array<{
    providerId: string;
    role: string;
    error: string;
    explicit: boolean;
  }>;
};

export type JsonDownloadResult = {
  value: unknown;
  text: string;
  size: number;
};

export async function uploadJsonPayload(
  synapse: Synapse,
  value: unknown,
  metadata: Record<string, string> = {},
  options: JsonUploadOptions = {}
): Promise<JsonUploadReceipt> {
  const text = JSON.stringify(value, null, 2);
  const data = textEncoder.encode(text);
  const contexts =
    configuredProviderIds.length === 0
      ? undefined
      : await synapse.storage.createContexts({
          providerIds: configuredProviderIds,
          metadata: datasetMetadata
        });
  await prepareStorageForBytes(synapse, BigInt(data.byteLength), contexts);
  const uploadTimeout = createTimeoutSignal(uploadTimeoutMs, "FOC upload timed out. Try again or choose another provider.");
  let submittedResolved = false;
  const chainTransactions: JsonUploadReceipt["chainTransactions"] = [];
  let resolveSubmitted: ((receipt: JsonUploadReceipt) => void) | null = null;
  let rejectSubmitted: ((error: Error) => void) | null = null;
  const submittedReceipt = new Promise<JsonUploadReceipt>((resolve, reject) => {
    resolveSubmitted = resolve;
    rejectSubmitted = reject;
  });

  const uploadPromise = synapse.storage.upload(data, {
    ...(contexts == null ? {} : { contexts }),
    signal: uploadTimeout.signal,
    metadata: datasetMetadata,
    pieceMetadata: metadata,
    callbacks: {
      onProgress(bytesUploaded) {
        options.onLifecycleEvent?.({ type: "progress", bytesUploaded });
      },
      onStored(providerId, pieceCid) {
        options.onLifecycleEvent?.({
          type: "stored",
          providerId: providerId.toString(),
          pieceCid: pieceCid.toString()
        });
      },
      onPiecesAdded(transaction, providerId, pieces) {
        const submittedPieceCid = pieces[0]?.pieceCid.toString();
        chainTransactions.push(
          ...pieces.map((piece) => ({
            transaction,
            providerId: providerId.toString(),
            pieceCid: piece.pieceCid.toString()
          }))
        );
        options.onLifecycleEvent?.({
          type: "pieces-added",
          transaction,
          providerId: providerId.toString(),
          pieces: pieces.map((piece) => ({ pieceCid: piece.pieceCid.toString() }))
        });

        if (options.returnAfter === "pieces-added" && !submittedResolved && submittedPieceCid != null) {
          submittedResolved = true;
          resolveSubmitted?.({
            pieceCid: submittedPieceCid,
            size: data.byteLength,
            requestedCopies: pieces.length,
            complete: false,
            chainTransactions: [...chainTransactions],
            copies: [],
            failedAttempts: []
          });
        }
      },
      onPiecesConfirmed(dataSetId, providerId, pieces) {
        options.onLifecycleEvent?.({
          type: "pieces-confirmed",
          dataSetId: dataSetId.toString(),
          providerId: providerId.toString(),
          pieces: pieces.map((piece) => ({
            pieceId: piece.pieceId.toString(),
            pieceCid: piece.pieceCid.toString()
          }))
        });
      },
      onCopyComplete(providerId, pieceCid) {
        options.onLifecycleEvent?.({
          type: "copy-complete",
          providerId: providerId.toString(),
          pieceCid: pieceCid.toString()
        });
      },
      onCopyFailed(providerId, pieceCid, error) {
        options.onLifecycleEvent?.({
          type: "copy-failed",
          providerId: providerId.toString(),
          pieceCid: pieceCid.toString(),
          error: error.message
        });
      },
      onPullProgress(providerId, pieceCid, status) {
        options.onLifecycleEvent?.({
          type: "pull-progress",
          providerId: providerId.toString(),
          pieceCid: pieceCid.toString(),
          status: String(status)
        });
      }
    }
  }).finally(uploadTimeout.cancel);

  const fullReceiptPromise = uploadPromise.then(async (result) => {
    const receipt: JsonUploadReceipt = {
      pieceCid: result.pieceCid.toString(),
      size: result.size,
      requestedCopies: result.requestedCopies,
      complete: result.complete,
      chainTransactions: [...chainTransactions],
      copies: result.copies.map((copy) => ({
        providerId: copy.providerId.toString(),
        dataSetId: copy.dataSetId.toString(),
        pieceId: copy.pieceId.toString(),
        role: copy.role,
        retrievalUrl: copy.retrievalUrl,
        isNewDataSet: copy.isNewDataSet
      })),
      failedAttempts: result.failedAttempts.map((attempt) => ({
        providerId: attempt.providerId.toString(),
        role: attempt.role,
        error: attempt.error,
        explicit: attempt.explicit
      }))
    };

    await verifyChainTransactions(synapse, receipt.chainTransactions);
    return receipt;
  });

  fullReceiptPromise
    .then((receipt) => {
      options.onComplete?.(receipt);
      if (options.returnAfter === "pieces-added" && !submittedResolved) {
        submittedResolved = true;
        resolveSubmitted?.(receipt);
      }
    })
    .catch((error) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      options.onError?.(normalizedError);
      if (options.returnAfter === "pieces-added" && !submittedResolved) {
        submittedResolved = true;
        rejectSubmitted?.(normalizedError);
      }
    });

  if (options.returnAfter === "pieces-added") {
    return submittedReceipt;
  }

  return fullReceiptPromise;
}

export async function downloadJsonPayload(synapse: Synapse, pieceCid: string): Promise<JsonDownloadResult> {
  const data = await withTimeout(synapse.storage.download({ pieceCid }), downloadTimeoutMs, "FOC restore timed out. Try again in a moment.");
  const text = textDecoder.decode(data);

  return {
    value: JSON.parse(text) as unknown,
    text,
    size: data.byteLength
  };
}

function parseProviderIds(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => BigInt(item));
}

function selectUploadProviderIds(providerIds: bigint[]) {
  if (providerIds.length <= 1) {
    return providerIds;
  }

  const preferredCalibrationProvider = providerIds.find((providerId) => providerId === 9n);
  return [preferredCalibrationProvider ?? providerIds[0]];
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createTimeoutSignal(milliseconds: number, reason: string) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort(new Error(reason));
  }, milliseconds);

  return {
    signal: controller.signal,
    cancel() {
      globalThis.clearTimeout(timeout);
    }
  };
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, reason: string) {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = globalThis.setTimeout(() => reject(new Error(reason)), milliseconds);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout != null) {
      globalThis.clearTimeout(timeout);
    }
  });
}

async function verifyChainTransactions(synapse: Synapse, transactions: JsonUploadReceipt["chainTransactions"]) {
  if (transactions.length === 0) {
    throw new Error("FOC did not return a chain transaction for this PieceCID.");
  }

  await Promise.all(
    transactions.map((transaction) =>
      withTimeout(
        waitForChainReceipt(synapse, transaction.transaction as Hash),
        chainReceiptTimeoutMs,
        `FOC transaction ${transaction.transaction} was not visible on-chain.`
      )
    )
  );
}

async function waitForChainReceipt(synapse: Synapse, hash: Hash) {
  const startedAt = Date.now();

  for (;;) {
    try {
      return await synapse.client.getTransactionReceipt({ hash });
    } catch (error) {
      if (Date.now() - startedAt >= chainReceiptTimeoutMs) {
        throw error;
      }

      await sleep(2_000);
    }
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}
