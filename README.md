# Agent Black Box

Agent Black Box is a Filecoin-backed AI agent prototype for the Filecoin ecosystem hackathon.

The core mechanism is simple: every important agent step becomes a trace capsule, and each capsule is stored through Filecoin Onchain Cloud with the Synapse SDK. A user can later verify or restore the agent's memory from its Filecoin receipt.

## Current Development Order

1. Project skeleton. Done.
2. Synapse / Filecoin wallet connection. Done.
3. JSON upload and download round trip. Done.
4. Trace capsule schema. Done.
5. Fixed agent workflow. Done.
6. Restore flow by PieceCID. Done.
7. Minimal trace timeline UI. Done.
8. Per-capsule verification from Filecoin. Done.
9. Demo-ready loading and status states. Done.
10. Upload lifecycle events and local run log. Done.

## Local Setup

```bash
npm install
npm run dev
```

The app uses MetaMask in the browser for Filecoin transactions. Server-side private keys are disabled.

```bash
npm run check:env
npm run check:filecoin
npm run restore:trace -- bafkzcibd3ybalxylmt5zcfriqi6ltl3n4fsnfhlx672syqqcdhcqn43uoosdusqa
```

When checking production builds locally, stop `npm run dev` before running `npm run build`. Next.js dev and build modes both write to `.next`, so running them at the same time can corrupt local generated artifacts.

## App Routes

- `GET /api/health` returns a disabled-server-key notice. Use the browser wallet UI instead.
- `POST /api/run-task` is legacy server-signing infrastructure and is not used by the MetaMask UI.
- `POST /api/restore-trace` is legacy server-signing infrastructure and is not used by the MetaMask UI.
- `POST /api/verify-capsule` is legacy server-signing infrastructure and is not used by the MetaMask UI.
- `GET /api/run-log` is legacy server-side log infrastructure. The MetaMask UI stores recent run receipts in browser local storage.

## Verified Demo PieceCID

The current sample final capsule is:

```text
bafkzcibd3ybalxylmt5zcfriqi6ltl3n4fsnfhlx672syqqcdhcqn43uoosdusqa
```

Restoring this PieceCID returns the sealed `plan -> analyze -> answer -> seal` trace chain.

## 60-90 Second Demo Script

1. Open `http://127.0.0.1:3000` and point out the mechanism: every agent step is sealed as a Filecoin trace capsule.
2. Click `Connect MetaMask`, switch to Filecoin Calibration if prompted, then click `Check FOC`.
3. Use the sample final PieceCID and click `Restore Chain`.
4. Wait for the four linked capsules to appear: `plan`, `analyze`, `answer`, and `seal`.
5. Click `Verify` on one capsule to download that exact PieceCID from Filecoin and show the raw JSON.
6. Explain that `Run and Seal` is the full live path: MetaMask signs the Filecoin transactions, each message submission immediately returns a PieceCID, and the UI keeps showing later confirmation events when the SDK emits them.

## Demo Notes

- Primary live path for judging: `Restore Chain` then `Verify`.
- Full write path: `Run and Seal`, best used when there is enough time for real storage uploads.
- `Run and Seal` shows Synapse upload lifecycle events such as provider store, add-pieces transaction submission, confirmation, copy completion, and failed provider attempts when the SDK emits them.
- Completed MetaMask `Run and Seal` executions are saved in browser local storage with the final PieceCID and all capsule PieceCIDs.
- The project is intentionally not a file uploader. Filecoin is the product mechanism: the agent's memory is addressable, restorable, and verifiable by PieceCID.
