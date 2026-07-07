import type { Synapse } from "@filoz/synapse-sdk";
import { prepareStorageForBytes } from "@/lib/filecoin/prepare";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
  await prepareStorageForBytes(synapse, BigInt(data.byteLength));
  let submittedResolved = false;
  let resolveSubmitted: ((receipt: JsonUploadReceipt) => void) | null = null;
  let rejectSubmitted: ((error: Error) => void) | null = null;
  const submittedReceipt = new Promise<JsonUploadReceipt>((resolve, reject) => {
    resolveSubmitted = resolve;
    rejectSubmitted = reject;
  });

  const uploadPromise = synapse.storage.upload(data, {
    metadata: {
      app: "agent-black-box"
    },
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
  });

  const fullReceiptPromise = uploadPromise.then((result) => ({
    pieceCid: result.pieceCid.toString(),
    size: result.size,
    requestedCopies: result.requestedCopies,
    complete: result.complete,
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
  }));

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
  const data = await synapse.storage.download({ pieceCid });
  const text = textDecoder.decode(data);

  return {
    value: JSON.parse(text) as unknown,
    text,
    size: data.byteLength
  };
}
