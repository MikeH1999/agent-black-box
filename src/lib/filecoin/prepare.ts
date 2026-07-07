import type { Synapse } from "@filoz/synapse-sdk";
import type { Hash, TransactionReceipt } from "viem";

export type PrepareStorageResult = {
  ready: boolean;
  depositNeeded: string;
  needsFwssMaxApproval: boolean;
  transaction: {
    hash: Hash;
    receipt: TransactionReceipt | null;
  } | null;
};

export async function prepareStorageForBytes(synapse: Synapse, dataSize: bigint): Promise<PrepareStorageResult> {
  const prepared = await synapse.storage.prepare({ dataSize });

  if (prepared.transaction == null) {
    return {
      ready: prepared.costs.ready,
      depositNeeded: prepared.costs.depositNeeded.toString(),
      needsFwssMaxApproval: prepared.costs.needsFwssMaxApproval,
      transaction: null
    };
  }

  let hash: Hash | null = null;
  const transaction = await prepared.transaction.execute({
    onHash: (transactionHash) => {
      hash = transactionHash;
    }
  });

  return {
    ready: prepared.costs.ready,
    depositNeeded: prepared.costs.depositNeeded.toString(),
    needsFwssMaxApproval: prepared.costs.needsFwssMaxApproval,
    transaction: {
      hash: transaction.hash ?? hash,
      receipt: transaction.receipt
    }
  };
}
