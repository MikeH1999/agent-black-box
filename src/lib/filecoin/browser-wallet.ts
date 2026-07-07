"use client";

import { Synapse } from "@filoz/synapse-sdk";
import { calibration, mainnet } from "@filoz/synapse-core/chains";
import { custom, formatEther, type Address, type EIP1193Provider, type Hex } from "viem";
import { restoreTraceChain } from "@/lib/agent/restore";
import { runFixedAgentWorkflow } from "@/lib/agent/workflow";
import type { ConversationSnapshot, FilecoinReceipt } from "@/lib/capsules/schema";
import { conversationSnapshotSchema, traceCapsuleSchema } from "@/lib/capsules/schema";
import { downloadJsonPayload, uploadJsonPayload, type JsonUploadLifecycleEvent } from "@/lib/filecoin/json-storage";

const targetNetwork = process.env.NEXT_PUBLIC_FILECOIN_NETWORK === "mainnet" ? mainnet : calibration;
const source = process.env.NEXT_PUBLIC_FILECOIN_SOURCE ?? "agent-black-box";

export type BrowserWalletState = {
  account: Address;
  chain: {
    id: number;
    name: string;
  };
};

export type BrowserWalletHealth = BrowserWalletState & {
  balance: string;
  contracts: {
    fwss: Address;
    filecoinPay: Address;
    pdp: Address;
  };
  storage: {
    token: string;
    providers: number;
    minUploadSize: number;
    maxUploadSize: number;
    allowanceApproved: boolean;
  };
};

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function hasInjectedWallet() {
  return typeof window !== "undefined" && window.ethereum != null;
}

export async function connectBrowserWallet(): Promise<BrowserWalletState> {
  const provider = getEthereumProvider();
  await provider.request({ method: "eth_requestAccounts" });
  await ensureTargetChain(provider);
  const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];

  if (accounts.length === 0) {
    throw new Error("No MetaMask account selected.");
  }

  return {
    account: accounts[0],
    chain: {
      id: targetNetwork.id,
      name: targetNetwork.name
    }
  };
}

export async function createBrowserSynapseClient() {
  const wallet = await connectBrowserWallet();

  return Synapse.create({
    account: wallet.account,
    chain: targetNetwork,
    transport: custom(getEthereumProvider()),
    source,
    withCDN: false
  });
}

export async function getBrowserWalletHealth(): Promise<BrowserWalletHealth> {
  const synapse = await createBrowserSynapseClient();
  const address = synapse.client.account.address;
  const [balance, storageInfo] = await Promise.all([
    synapse.client.getBalance({ address }),
    synapse.storage.getStorageInfo()
  ]);

  return {
    account: address,
    chain: {
      id: synapse.chain.id,
      name: synapse.chain.name
    },
    balance: `${formatEther(balance)} FIL`,
    contracts: {
      fwss: synapse.chain.contracts.fwss.address,
      filecoinPay: synapse.chain.contracts.filecoinPay.address,
      pdp: synapse.chain.contracts.pdp.address
    },
    storage: {
      token: storageInfo.pricing.tokenSymbol,
      providers: storageInfo.providers.length,
      minUploadSize: storageInfo.serviceParameters.minUploadSize,
      maxUploadSize: storageInfo.serviceParameters.maxUploadSize,
      allowanceApproved: storageInfo.allowances?.isApproved ?? false
    }
  };
}

export async function runWalletBackedWorkflow(
  task: string,
  options: Parameters<typeof runFixedAgentWorkflow>[2] = {}
) {
  const synapse = await createBrowserSynapseClient();
  return runFixedAgentWorkflow(synapse, task, options);
}

export async function sealWalletBackedConversation(
  snapshot: ConversationSnapshot,
  options: {
    returnAfter?: "complete" | "pieces-added";
    onUploadLifecycleEvent?: (event: JsonUploadLifecycleEvent) => void;
  } = {}
) {
  const synapse = await createBrowserSynapseClient();
  const validatedSnapshot = conversationSnapshotSchema.parse(snapshot);
  const upload = await uploadJsonPayload(
    synapse,
    validatedSnapshot,
    {
      capsuleVersion: validatedSnapshot.capsuleVersion,
      kind: "conversation",
      conversationId: validatedSnapshot.conversationId
    },
    {
      returnAfter: options.returnAfter,
      onLifecycleEvent(event) {
        options.onUploadLifecycleEvent?.(event);
      }
    }
  );

  const receipt: FilecoinReceipt = {
    pieceCid: upload.pieceCid,
    uploadedAt: new Date().toISOString(),
    size: upload.size,
    requestedCopies: upload.requestedCopies,
    complete: upload.complete,
    copies: upload.copies,
    failedAttempts: upload.failedAttempts
  };

  return {
    snapshot: validatedSnapshot,
    receipt
  };
}

export async function restoreWalletBackedConversation(pieceCid: string) {
  const synapse = await createBrowserSynapseClient();
  const downloaded = await downloadJsonPayload(synapse, pieceCid);
  const snapshot = conversationSnapshotSchema.parse(downloaded.value);

  return {
    pieceCid,
    size: downloaded.size,
    rawJson: downloaded.text,
    snapshot
  };
}

export async function restoreWalletBackedTrace(pieceCid: string) {
  const synapse = await createBrowserSynapseClient();
  return restoreTraceChain(synapse, pieceCid);
}

export async function verifyWalletBackedCapsule(pieceCid: string) {
  const synapse = await createBrowserSynapseClient();
  const downloaded = await downloadJsonPayload(synapse, pieceCid);
  const capsule = traceCapsuleSchema.parse(downloaded.value);

  return {
    pieceCid,
    size: downloaded.size,
    rawJson: downloaded.text,
    capsule
  };
}

function getEthereumProvider(): EIP1193Provider {
  if (!hasInjectedWallet()) {
    throw new Error("MetaMask is not available. Install MetaMask and connect a Filecoin-compatible account.");
  }

  return window.ethereum as EIP1193Provider;
}

async function ensureTargetChain(provider: EIP1193Provider) {
  const currentChainId = (await provider.request({ method: "eth_chainId" })) as Hex;
  const targetChainId = toHexChainId(targetNetwork.id);

  if (currentChainId.toLowerCase() === targetChainId.toLowerCase()) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }]
    });
  } catch (error) {
    if (isUnknownChainError(error)) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: targetChainId,
            chainName: targetNetwork.name,
            nativeCurrency: targetNetwork.nativeCurrency,
            rpcUrls: targetNetwork.rpcUrls.default.http,
            blockExplorerUrls: targetNetwork.blockExplorers?.default?.url
              ? [targetNetwork.blockExplorers.default.url]
              : undefined
          }
        ]
      });
      return;
    }

    throw error;
  }
}

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}` as Hex;
}

function isUnknownChainError(error: unknown) {
  return typeof error === "object" && error != null && "code" in error && error.code === 4902;
}
