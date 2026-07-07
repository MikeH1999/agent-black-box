import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

console.log("Server private keys are disabled.");
console.log(`NEXT_PUBLIC_FILECOIN_NETWORK=${process.env.NEXT_PUBLIC_FILECOIN_NETWORK ?? "calibration"}`);
console.log(`NEXT_PUBLIC_FILECOIN_SOURCE=${process.env.NEXT_PUBLIC_FILECOIN_SOURCE ?? "agent-black-box"}`);
console.log("Use the Connect MetaMask button in the app for Filecoin transactions.");
