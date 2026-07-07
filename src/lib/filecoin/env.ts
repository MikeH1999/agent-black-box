import { z } from "zod";

const filecoinEnvSchema = z.object({
  FILECOIN_NETWORK: z.enum(["calibration", "mainnet"]).default("calibration"),
  FILECOIN_RPC_URL: z.string().url().optional(),
  FILECOIN_SOURCE: z.string().default("agent-black-box")
});

export function getFilecoinEnv() {
  const env = filecoinEnvSchema.parse({
    FILECOIN_NETWORK: process.env.FILECOIN_NETWORK,
    FILECOIN_RPC_URL: process.env.FILECOIN_RPC_URL,
    FILECOIN_SOURCE: process.env.FILECOIN_SOURCE
  });

  return {
    ...env,
    FILECOIN_RPC_URL: env.FILECOIN_RPC_URL ?? getDefaultRpcUrl(env.FILECOIN_NETWORK)
  };
}

function getDefaultRpcUrl(network: "calibration" | "mainnet") {
  if (network === "mainnet") {
    return "https://api.node.glif.io/rpc/v1";
  }

  return "https://api.calibration.node.glif.io/rpc/v1";
}
