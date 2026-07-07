import { calibration, mainnet } from "@filoz/synapse-core/chains";
import { http } from "viem";
import { getFilecoinEnv } from "@/lib/filecoin/env";

export function getConfiguredFilecoinNetwork() {
  const env = getFilecoinEnv();

  return {
    chain: env.FILECOIN_NETWORK === "mainnet" ? mainnet : calibration,
    rpcUrl: env.FILECOIN_RPC_URL,
    source: env.FILECOIN_SOURCE
  };
}

export function createReadOnlyFilecoinTransport() {
  const network = getConfiguredFilecoinNetwork();
  return http(network.rpcUrl);
}

export function createSynapseClient(): never {
  throw new Error("Server-side Filecoin private keys are disabled. Connect MetaMask in the browser to run Synapse.");
}
