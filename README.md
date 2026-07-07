# Agent Black Box

Agent Black Box is a Filecoin Onchain Cloud prototype for saving useful AI conversations as portable, restorable memory capsules.

The product mechanism is no longer a generic file upload or a one-shot question/answer trace. A user has a conversation, saves the conversation as a local black box, adds a note, and then decides whether to seal that exact conversation to Filecoin through Synapse SDK. After upload, the app keeps only the wallet-scoped index record with the note and PieceCID, and removes the full local conversation cache.

## Current Workflow

1. Connect MetaMask.
2. Configure an AI model, or use the local demo reply.
3. Chat with text and images.
4. Save the useful conversation as a black box.
5. Add or edit the note on that saved record.
6. Upload that single saved record to Filecoin Onchain Cloud.
7. Copy the returned PieceCID.
8. Restore the conversation later by PieceCID and use it as context.

## Core Features

- Wallet-scoped saved conversations. Saved records only appear after connecting the wallet that created them.
- Conversation snapshots with text, pasted screenshots, dropped image files, and uploaded images.
- Per-record notes. The note becomes the human-readable label in the left-side saved conversation shortcuts.
- Per-record upload. Each saved black box can be uploaded to FOC independently.
- Local cache cleanup after upload. The app removes the full local conversation snapshot after a PieceCID is returned, while keeping the note and PieceCID index.
- Restore by PieceCID. A sealed conversation can be downloaded from Filecoin and loaded back into the chat as context.
- OpenAI-compatible model switching. Add API URL and API key, load available models, choose a model, then save and switch between model configs.

## Filecoin Mechanism

The Filecoin primitive is visible in the main loop:

- A conversation becomes a `conversation-1` JSON capsule.
- The capsule is uploaded through Synapse SDK using the browser wallet.
- The returned PieceCID is the durable handle for the saved conversation.
- The app can restore the full conversation from that PieceCID.
- After sealing, the browser keeps only a wallet-scoped index record, not the full local conversation cache.

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

When checking production builds locally, stop `npm run dev` before running `npm run build`. Next.js dev and build modes both write to `.next`, so running them at the same time can corrupt local generated artifacts.

## AI Model Setup

The AI model panel supports OpenAI-compatible APIs.

1. Enter API URL, for example:

```text
https://api.openai.com/v1
```

2. Enter API key.
3. Click `Load Models`.
4. Choose a model from the dropdown.
5. Click `Add Model`.
6. Click `Use` on any saved model config to switch.

API keys are stored only in browser local storage for the local prototype. Do not commit keys to GitHub.

## Chat Input

- Press `Enter` to send.
- Press `Shift+Enter` to insert a newline.
- Paste a screenshot directly into the text box.
- Drag image files into the text box.
- `Add images` remains as a fallback file picker.

## Browser Storage

Saved data is scoped by wallet address.

Index records:

```text
agent-black-box:conversation-index:<wallet>
```

Full local conversation snapshots before upload:

```text
agent-black-box:conversation-snapshot:<wallet>:<conversationId>
```

After upload succeeds, the `conversation-snapshot:<wallet>:<conversationId>` entry is removed. The index keeps the note, PieceCID, message count, image count, and display metadata.

AI model configs:

```text
agent-black-box:ai-model-configs
agent-black-box:active-ai-model-config
```

## App Routes

- `POST /api/ai-chat` proxies OpenAI-compatible `/chat/completions` requests.
- `POST /api/ai-models` loads OpenAI-compatible `/models` results.
- `GET /api/health` returns a disabled-server-key notice. Use the browser wallet UI instead.
- Legacy trace routes still exist for older experiments but are not the primary UI path:
  - `POST /api/run-task`
  - `POST /api/restore-trace`
  - `POST /api/verify-capsule`
  - `GET /api/run-log`

## 60-90 Second Demo Script

1. Open the app and explain the mechanism: the product saves a useful conversation as a black box, then optionally seals it to Filecoin.
2. Connect MetaMask.
3. Add an AI model config: API URL, API key, `Load Models`, select one model, `Add Model`, then `Use`.
4. Send a message. Paste or drag in an image to show multimodal input.
5. Click `Save Black Box`.
6. In `Saved Black Boxes`, edit the note for that single record.
7. Click `Upload to FOC`.
8. Show the returned PieceCID and copy button.
9. Point out that local conversation cache is removed after upload.
10. Click `Use as Context` or paste the PieceCID into `Restore Context` to restore the conversation from Filecoin.

## Demo Notes

- This is intentionally not a cloud drive. Filecoin is the memory mechanism: the PieceCID is the durable handle for an AI conversation.
- For hackathon demos, use small images because the MVP stores images as data URLs inside the JSON conversation capsule.
- A production version should upload large images as separate Filecoin objects and reference their PieceCIDs inside the conversation capsule.
- If no AI model is configured, the UI still works with a local demo reply so Filecoin save/upload/restore can be demonstrated.
