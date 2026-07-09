https://x.com/Mikeh0321/status/2074792145232568495?s=20

@FilecoinTLDR

@Filecoin

# Important Information

You can claim Tfil and usdtfil test tokens at the following two locations:

# tfil：

https://faucet.calibnet.chainsafe-fil.io/funds.html

https://forest-explorer.chainsafe.dev/faucet/calibnet

https://beryx.zondax.ch/faucet/

# usdfc：

https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc


# Agent Black Box

Agent Black Box is a Filecoin Onchain Cloud prototype for turning valuable AI conversations into portable, restorable memory capsules.

Instead of uploading arbitrary files, the app lets a user chat with an AI model, attach screenshots or images, save a useful exchange as a local black box, add a note, and then decide whether to seal that conversation to Filecoin through Synapse SDK. Once uploaded, the returned PieceCID becomes the handle for restoring that conversation later.

## Product Mechanism

1. A user connects MetaMask.
2. The user chats with an AI model, including text and images.
3. The user saves a useful exchange as a black box.
4. The saved black box appears as a local draft for that wallet.
5. The user edits the note for that single saved record.
6. The user optionally uploads that record to Filecoin Onchain Cloud.
7. The app returns a PieceCID and removes the full local conversation cache.
8. The sealed conversation can later be restored only by PieceCID.

The main idea: Filecoin is not just storage behind the scenes. The PieceCID is the product-level memory key.

## Current Features

- MetaMask browser wallet connection.
- MetaMask reconnect requests account permissions again so users can switch accounts after disconnecting.
- Floating status card that stays visible in the top-right corner while scrolling.
- Official Filecoin Onchain Cloud icon in the header and upload buttons.
- Wallet-scoped local drafts.
- Unuploaded drafts reappear after reconnecting the same wallet.
- Uploaded/sealed conversations are not auto-loaded on wallet connect.
- Restore by PieceCID through `Restore Context`.
- Restore progress display with current step, percentage, progress bar, and elapsed seconds.
- Wallet-scoped uploaded record index with note and PieceCID for later restore.
- Uploaded records are paginated in the Restore panel, with 5, 10, or 20 records per page.
- Restored context must receive new messages before it can be saved as a new black box.
- Per-record notes for saved black boxes.
- Left-side saved conversation shortcuts, using the note as the button label.
- Per-record `Upload to FOC`.
- Batch `Upload All Drafts` for all unuploaded local drafts.
- FOC upload can run in the background while the user continues chatting, saving, or starting a new conversation.
- `Use as Context` and uploaded record restore remain clickable during background upload.
- Unuploaded local drafts can be deleted from `Saved Black Boxes`.
- Full local conversation snapshot removal after upload.
- PieceCID hover-copy buttons with `Copied!` feedback.
- Text chat with assistant waiting state while the selected model replies.
- `Enter` to send and `Shift+Enter` for a newline.
- Screenshot paste directly into the text box.
- Drag-and-drop image files into the text box.
- Fallback `Add images` file picker.
- OpenAI-compatible model configuration.
- Load model list from API URL + API key.
- Switch between saved model configs.
- Local demo reply when no AI model is configured.

## AI Model Setup

The model panel supports OpenAI-compatible APIs.

1. Enter API URL, for example:

```text
https://api.openai.com/v1
```

2. Enter API key.
3. Click `Load Models`.
4. Select a model from the dropdown.
5. Click `Add Model`.
6. Click `Use` on any saved model config to switch.

The saved model name is the selected model name. There is no separate model remark field.

API keys are stored locally for this prototype in browser local storage and mirrored to `.local-data/agent-black-box-state.json` so model configs survive browser cache clearing. The `.local-data` directory is ignored by Git and should not be committed.

## Filecoin / FOC Flow

When a saved black box is uploaded:

1. The conversation becomes a `conversation-1` JSON capsule.
2. The browser wallet signs the Synapse/Filecoin flow.
3. Synapse uploads the capsule to Filecoin Onchain Cloud.
4. The UI shows upload lifecycle events.
5. Once a PieceCID is returned, the record becomes FOC-sealed.
6. The full local conversation snapshot is removed.
7. The note and PieceCID remain visible in the current session.
8. The wallet-scoped uploaded record index keeps the note and PieceCID for later restore.
9. On a future session, the sealed conversation must be restored by PieceCID.

This means the app separates local drafts from sealed Filecoin memory:

```text
Unuploaded draft = local wallet-scoped cache
Uploaded black box = Filecoin memory, restored by PieceCID
```

## Browser Storage

Saved data is scoped by wallet address.

Local draft index:

```text
agent-black-box:conversation-index:<wallet>
```

Full local draft snapshot:

```text
agent-black-box:conversation-snapshot:<wallet>:<conversationId>
```

After upload succeeds, the full `conversation-snapshot:<wallet>:<conversationId>` entry is removed.
The lightweight wallet index may retain note and PieceCID records so the Restore panel can show uploaded records without loading the full conversation.

AI model configs:

```text
agent-black-box:ai-model-configs
agent-black-box:active-ai-model-config
```

These model configs live in browser local storage. They are not part of the repository and are not included in Git commits.

The app also mirrors uploaded wallet records and AI model configs to a local ignored file:

```text
.local-data/agent-black-box-state.json
```

This lets model configs and uploaded PieceCID records survive browser cache clearing on the same machine. The `.local-data` directory is ignored by Git and must not be committed.

To verify that no full conversation cache remains:

```js
Object.keys(localStorage).filter((key) =>
  key.startsWith("agent-black-box:conversation-snapshot:")
);
```

## Wallet Behavior

- Connecting a wallet loads only that wallet's unuploaded local drafts.
- Connecting a wallet does not auto-load sealed FOC conversations.
- Connecting a wallet can show lightweight uploaded records with note and PieceCID.
- Disconnecting a wallet clears the current visible session state.
- Unuploaded drafts are still available when reconnecting the same wallet.
- Sealed conversations must be restored from Filecoin by PieceCID.
- Restoring a sealed conversation alone does not create a new saveable record; continue the conversation first.

## Local Setup

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

The app uses MetaMask in the browser for Filecoin transactions. Server-side private keys are disabled.

When checking production builds locally, stop `npm run dev` before running `npm run build`. Next.js dev and build modes both write to `.next`, so running them at the same time can corrupt generated artifacts.

## Public Deployment

This project can be deployed as a public Next.js app on Vercel or Netlify. The deployed app is usable by anyone with MetaMask and a Filecoin-compatible account.

Before deploying:

```bash
npm install
npm run typecheck
npm run build
```

Production environment variables:

```text
NEXT_PUBLIC_FILECOIN_NETWORK=calibration
NEXT_PUBLIC_FILECOIN_SOURCE=agent-black-box
NEXT_PUBLIC_FOC_PROVIDER_IDS=9
NEXT_PUBLIC_FOC_UPLOAD_TIMEOUT_MS=180000
NEXT_PUBLIC_FOC_DOWNLOAD_TIMEOUT_MS=60000
NEXT_PUBLIC_FOC_CHAIN_RECEIPT_TIMEOUT_MS=60000
NEXT_PUBLIC_APP_NAME=Agent Black Box
```

Use `calibration` for public demos and hackathon judging. Switch to `mainnet` only when you want real mainnet Filecoin usage.

`NEXT_PUBLIC_FOC_PROVIDER_IDS` is optional but recommended for hosted demos. On calibration, the app defaults to `9` so uploads do not depend on SDK smart provider selection when endorsed provider health checks are flaky. For demo reliability, the app uses one provider even if the env var contains multiple comma-separated IDs.

`NEXT_PUBLIC_FOC_UPLOAD_TIMEOUT_MS`, `NEXT_PUBLIC_FOC_DOWNLOAD_TIMEOUT_MS`, and `NEXT_PUBLIC_FOC_CHAIN_RECEIPT_TIMEOUT_MS` keep hosted demos from waiting indefinitely on a slow provider, retrieval URL, or chain receipt lookup.

These are public client-side variables. Do not add private keys. The app uses the visitor's MetaMask wallet in the browser for Filecoin actions. AI model API keys are entered by each visitor in their own browser and stored locally for this prototype.

### Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, choose `Add New Project`, then import the repo.
3. Keep the detected framework as `Next.js`.
4. Set:
   - Build command: `npm run build`
   - Install command: `npm install`
5. Add the environment variables listed above for Production and Preview.
6. Deploy.
7. Open the generated Vercel URL and test:
   - Connect MetaMask.
   - Add an OpenAI-compatible model config.
   - Save a black box.
   - Upload to FOC.
   - Copy the returned PieceCID.
   - Restore by PieceCID in a fresh browser session.

CLI alternative:

```bash
npm i -g vercel
vercel
vercel env add NEXT_PUBLIC_FILECOIN_NETWORK production
vercel env add NEXT_PUBLIC_FILECOIN_SOURCE production
vercel env add NEXT_PUBLIC_APP_NAME production
vercel --prod
```

### Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify, choose `Add new site`, then import the repo.
3. Keep the detected framework as `Next.js`.
4. Set:
   - Build command: `npm run build`
   - Publish directory: leave the Next.js default selected by Netlify.
5. Add the environment variables listed above.
6. Deploy.
7. Open the generated Netlify URL and run the same MetaMask, upload, copy, and restore smoke test.

### Production Storage Note

The `.local-data` mirror is for local development only. Public deployments do not use it as persistent shared storage. Visitor state lives in that visitor's browser local storage, and sealed memories live on Filecoin by PieceCID.

## Launch Copy

README badge/link template:

```md
Try Agent Black Box: https://YOUR_DEPLOYED_URL
```

X post template:

```text
I built Agent Black Box: a Filecoin Onchain Cloud prototype that turns useful AI conversations into restorable memory capsules.

Connect MetaMask, chat with an AI model, save a black box, upload it through Synapse SDK, then restore the full conversation later from its PieceCID.

Try it: https://YOUR_DEPLOYED_URL

#Filecoin #OnchainCloud #AI
```

## App Routes

- `POST /api/ai-chat` proxies OpenAI-compatible `/chat/completions` requests.
- `POST /api/ai-models` loads OpenAI-compatible `/models` results.
- `GET/POST /api/local-state/models` reads and writes local AI model configs.
- `GET/POST /api/local-state/wallet-records` reads and writes wallet-scoped uploaded record indexes.
- `GET /api/health` returns a disabled-server-key notice. Use the browser wallet UI instead.
- Legacy trace routes still exist for older experiments but are not the primary UI path:
  - `POST /api/run-task`
  - `POST /api/restore-trace`
  - `POST /api/verify-capsule`
  - `GET /api/run-log`

## Demo Script

1. Open the app and explain the black box mechanism.
2. Connect MetaMask.
3. Add an AI model: API URL, API key, `Load Models`, select a model, `Add Model`, then `Use`.
4. Send a message and show the assistant waiting state.
5. Paste a screenshot or drag an image into the text box.
6. Click `Save Black Box`.
7. Edit the note on that saved record.
8. Click `Upload to FOC`.
9. Copy the returned PieceCID.
10. Point out that full local conversation cache is removed after upload.
11. Paste the PieceCID into `Restore Context`.
12. Show the restore progress steps: wallet, download, parse, loaded.
13. Restore the conversation from Filecoin and use it as context.

## Demo Notes

- This is intentionally not a cloud drive.
- Filecoin is the memory mechanism: the PieceCID restores an AI conversation.
- For hackathon demos, use small images because the MVP stores images as data URLs inside the JSON conversation capsule.
- A production version should upload large images as separate Filecoin objects and reference their PieceCIDs inside the conversation capsule.
- If no AI model is configured, the UI still works with a local demo reply so Filecoin save/upload/restore can be demonstrated.
