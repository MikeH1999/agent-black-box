"use client";

import { useEffect, useMemo, useState, type ClipboardEvent, type DragEvent } from "react";
import type { ConversationImage, ConversationMessage, ConversationSnapshot, FilecoinReceipt } from "@/lib/capsules/schema";
import {
  connectBrowserWallet,
  getBrowserWalletHealth,
  restoreWalletBackedConversation,
  sealWalletBackedConversation,
  type BrowserWalletState
} from "@/lib/filecoin/browser-wallet";
import type { JsonUploadLifecycleEvent } from "@/lib/filecoin/json-storage";

type HealthState = {
  account: string;
  chain: { id: number; name: string };
  balance: string;
  storage: {
    token: string;
    providers: number;
    allowanceApproved: boolean;
  };
};

type ActiveAction = "health" | "chat" | "upload" | "restore" | null;

type BlackBoxRecord = {
  id: string;
  title: string;
  note: string;
  pieceCid: string | null;
  createdAt: string;
  uploadedAt: string | null;
  messageCount: number;
  imageCount: number;
};

type UploadLifecycleEvent = {
  id: string;
  event: JsonUploadLifecycleEvent;
};

type AiModelConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
};

type AiModelForm = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const blackBoxIndexKey = "agent-black-box:conversation-index";
const blackBoxSnapshotPrefix = "agent-black-box:conversation-snapshot:";
const aiModelConfigKey = "agent-black-box:ai-model-configs";
const activeAiModelConfigKey = "agent-black-box:active-ai-model-config";

export function AgentConsole() {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ConversationImage[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [note, setNote] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState<ConversationSnapshot | null>(null);
  const [blackBoxes, setBlackBoxes] = useState<BlackBoxRecord[]>([]);
  const [restorePieceCid, setRestorePieceCid] = useState("");
  const [contextLabel, setContextLabel] = useState<string | null>(null);
  const [sealedReceipt, setSealedReceipt] = useState<FilecoinReceipt | null>(null);
  const [uploadEvents, setUploadEvents] = useState<UploadLifecycleEvent[]>([]);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState | null>(null);
  const [showHealthPopover, setShowHealthPopover] = useState(false);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [wallet, setWallet] = useState<BrowserWalletState | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [aiConfigs, setAiConfigs] = useState<AiModelConfig[]>([]);
  const [activeAiConfigId, setActiveAiConfigId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [aiForm, setAiForm] = useState<AiModelForm>({
    baseUrl: "",
    apiKey: "",
    model: ""
  });
  const walletAccount = wallet?.account.toLowerCase() ?? null;

  useEffect(() => {
    if (walletAccount == null) {
      setBlackBoxes([]);
      return;
    }

    const stored = window.localStorage.getItem(getBlackBoxIndexKey(walletAccount));
    if (stored != null) {
      setBlackBoxes(JSON.parse(stored) as BlackBoxRecord[]);
    } else {
      setBlackBoxes([]);
    }
  }, [walletAccount]);

  useEffect(() => {
    const storedConfigs = window.localStorage.getItem(aiModelConfigKey);
    const storedActiveConfigId = window.localStorage.getItem(activeAiModelConfigKey);
    if (storedConfigs != null) {
      const parsedConfigs = JSON.parse(storedConfigs) as AiModelConfig[];
      setAiConfigs(parsedConfigs);
      setActiveAiConfigId(storedActiveConfigId ?? parsedConfigs[0]?.id ?? null);
    }
  }, []);

  useEffect(() => {
    if (busyStartedAt == null) {
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - busyStartedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [busyStartedAt]);

  const isBusy = activeAction != null;
  const imageCount = useMemo(() => messages.reduce((total, message) => total + message.images.length, 0), [messages]);
  const statusDetail = getStatusDetail(activeAction);
  const activeAiConfig = aiConfigs.find((config) => config.id === activeAiConfigId) ?? null;

  async function connectWallet() {
    setStatus("Connecting MetaMask");
    setError(null);

    const connectedWallet = await connectBrowserWallet();
    setWallet(connectedWallet);
    setStatus("MetaMask connected");
  }

  function disconnectWallet() {
    setWallet(null);
    setHealth(null);
    setShowHealthPopover(false);
    setBlackBoxes([]);
    setSavedSnapshot(null);
    setContextLabel(null);
    setError(null);
    setStatus("Ready");
  }

  async function checkHealth() {
    setStatus("Checking FOC");
    setError(null);

    const data = await getBrowserWalletHealth();

    if (wallet == null || wallet.account !== data.account) {
      setWallet({
        account: data.account,
        chain: data.chain
      });
    }

    setHealth(data);
    setShowHealthPopover(true);
    setStatus("FOC ready");
  }

  async function sendMessage() {
    const cleanDraft = draft.trim();
    if (cleanDraft.length === 0 && attachments.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: cleanDraft,
      images: attachments,
      createdAt: now
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setDraft("");
    setAttachments([]);
    setSavedSnapshot(null);
    setSealedReceipt(null);
    setStatus(activeAiConfig == null ? "Conversation updated" : `Calling ${activeAiConfig.model}`);

    const assistantText =
      activeAiConfig == null
        ? buildAssistantReply(cleanDraft, attachments, contextLabel)
        : await requestAiAnswer(activeAiConfig, nextMessages);
    const assistantMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: assistantText,
      images: [],
      createdAt: new Date().toISOString()
    };

    setMessages([...nextMessages, assistantMessage]);
    setStatus("Conversation updated");
  }

  async function attachImages(files: FileList | null) {
    if (files == null || files.length === 0) {
      return;
    }

    await addImageFiles(Array.from(files));
  }

  async function addImageFiles(files: File[]) {
    const images = await Promise.all(
      files
        .filter((file) => file.type.startsWith("image/"))
        .map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: await readFileAsDataUrl(file)
        }))
    );

    setAttachments((current) => [...current, ...images]);
  }

  function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    void addImageFiles(files);
    setStatus("Screenshot attached");
  }

  function dragFilesOverInput(event: DragEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    setIsDraggingFiles(true);
  }

  function leaveDraggedFiles() {
    setIsDraggingFiles(false);
  }

  function dropFilesOnInput(event: DragEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    setIsDraggingFiles(false);
    void addImageFiles(Array.from(event.dataTransfer.files));
    setStatus("File attached");
  }

  function saveAiConfig() {
    if (aiForm.baseUrl.trim().length === 0 || aiForm.apiKey.trim().length === 0 || aiForm.model.trim().length === 0) {
      setError("API URL, API key, and model are required.");
      setStatus("Model config incomplete");
      return;
    }

    const config: AiModelConfig = {
      id: crypto.randomUUID(),
      baseUrl: aiForm.baseUrl.trim(),
      apiKey: aiForm.apiKey.trim(),
      model: aiForm.model.trim(),
      createdAt: new Date().toISOString()
    };
    const nextConfigs = [config, ...aiConfigs].slice(0, 12);
    setAiConfigs(nextConfigs);
    setActiveAiConfigId(config.id);
    window.localStorage.setItem(aiModelConfigKey, JSON.stringify(nextConfigs));
    window.localStorage.setItem(activeAiModelConfigKey, config.id);
    setAiForm({ baseUrl: "", apiKey: "", model: "" });
    setAvailableModels([]);
    setError(null);
    setStatus(`Using ${config.model}`);
  }

  async function loadAiModels() {
    if (aiForm.baseUrl.trim().length === 0 || aiForm.apiKey.trim().length === 0) {
      setError("API URL and API key are required before loading models.");
      setStatus("Model config incomplete");
      return;
    }

    setIsLoadingModels(true);
    setError(null);
    try {
      const response = await fetch("/api/ai-models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          baseUrl: aiForm.baseUrl.trim(),
          apiKey: aiForm.apiKey.trim()
        })
      });
      const data = (await response.json()) as { models?: string[]; error?: unknown };
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? data));
      }

      const models = data.models ?? [];
      setAvailableModels(models);
      setAiForm((current) => ({
        ...current,
        model: models.includes(current.model) ? current.model : models[0] ?? ""
      }));
      setStatus(models.length === 0 ? "No models returned" : `Loaded ${models.length} models`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("Model load failed");
    } finally {
      setIsLoadingModels(false);
    }
  }

  function useAiConfig(config: AiModelConfig) {
    setActiveAiConfigId(config.id);
    window.localStorage.setItem(activeAiModelConfigKey, config.id);
    setStatus(`Using ${config.model}`);
  }

  function removeAiConfig(id: string) {
    const nextConfigs = aiConfigs.filter((config) => config.id !== id);
    const nextActiveId = activeAiConfigId === id ? nextConfigs[0]?.id ?? null : activeAiConfigId;
    setAiConfigs(nextConfigs);
    setActiveAiConfigId(nextActiveId);
    window.localStorage.setItem(aiModelConfigKey, JSON.stringify(nextConfigs));
    if (nextActiveId == null) {
      window.localStorage.removeItem(activeAiModelConfigKey);
    } else {
      window.localStorage.setItem(activeAiModelConfigKey, nextActiveId);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  function saveBlackBox() {
    const storageAccount = requireWalletStorageAccount();
    const snapshot = createSnapshot(messages, note);
    persistSnapshot(storageAccount, snapshot);
    setSavedSnapshot(snapshot);
    upsertBlackBoxRecord(createRecord(snapshot, null));
    setStatus("Black box saved locally");
  }

  function startNewConversation() {
    if (messages.length > 0) {
      if (walletAccount == null) {
        setError("Connect MetaMask before saving the previous conversation.");
        setStatus("Wallet required");
        return;
      }

      const storageAccount = requireWalletStorageAccount();
      const snapshot: ConversationSnapshot = savedSnapshot == null ? createSnapshot(messages, note) : { ...savedSnapshot, note };
      persistSnapshot(storageAccount, snapshot);
      upsertBlackBoxRecord(createRecord(snapshot, sealedReceipt));
    }

    setMessages([]);
    setDraft("");
    setAttachments([]);
    setNote("");
    setSavedSnapshot(null);
    setSealedReceipt(null);
    setUploadEvents([]);
    setContextLabel(null);
    setStatus(messages.length > 0 ? "Previous black box saved locally" : "New conversation ready");
  }

  async function uploadBlackBoxRecord(record: BlackBoxRecord) {
    const storageAccount = requireWalletStorageAccount();
    const localSnapshot = loadLocalSnapshot(storageAccount, record.id);
    if (localSnapshot == null) {
      throw new Error("This black box has no local conversation cache. Restore it from FOC instead.");
    }

    const snapshotWithCurrentNote: ConversationSnapshot = {
      ...localSnapshot,
      note: record.note
    };

    persistSnapshot(storageAccount, snapshotWithCurrentNote);
    setUploadEvents([]);
    setSealedReceipt(null);
    setStatus(`Uploading ${record.title}`);

    const result = await sealWalletBackedConversation(snapshotWithCurrentNote, {
      returnAfter: "pieces-added",
      onUploadLifecycleEvent(event) {
        setUploadEvents((current) => [...current, { id: crypto.randomUUID(), event }].slice(-6));
        setStatus(describeUploadEvent(event));
      }
    });

    setSealedReceipt(result.receipt);
    setRestorePieceCid(result.receipt.pieceCid);
    upsertBlackBoxRecord(createRecord(snapshotWithCurrentNote, result.receipt));
    removeLocalSnapshot(storageAccount, record.id);
    if (savedSnapshot?.conversationId === record.id) {
      setSavedSnapshot(null);
    }
    setStatus(result.receipt.complete === false ? "Black box submitted; local cache removed" : "Black box sealed; local cache removed");
  }

  async function restoreConversation(pieceCid = restorePieceCid.trim()) {
    if (pieceCid.length === 0) {
      throw new Error("Enter a conversation PieceCID to restore.");
    }

    setStatus("Restoring black box");
    setError(null);

    const storageAccount = await ensureWalletStorageAccount();
    const restored = await restoreWalletBackedConversation(pieceCid);
    setMessages(restored.snapshot.messages);
    setNote(restored.snapshot.note);
    setSavedSnapshot(restored.snapshot);
    setSealedReceipt({
      pieceCid: restored.pieceCid,
      uploadedAt: restored.snapshot.createdAt,
      size: restored.size,
      complete: true,
      requestedCopies: 1,
      copies: [],
      failedAttempts: []
    });
    setContextLabel(restored.snapshot.title);
    persistSnapshot(storageAccount, restored.snapshot);
    upsertBlackBoxRecord(createRecord(restored.snapshot, {
      pieceCid: restored.pieceCid,
      uploadedAt: restored.snapshot.createdAt,
      size: restored.size,
      complete: true,
      requestedCopies: 1,
      copies: [],
      failedAttempts: []
    }), storageAccount);
    setStatus("Context restored");
  }

  async function loadBlackBox(record: BlackBoxRecord) {
    const storageAccount = requireWalletStorageAccount();
    const localSnapshot = loadLocalSnapshot(storageAccount, record.id);
    if (localSnapshot != null) {
      setMessages(localSnapshot.messages);
      setNote(localSnapshot.note);
      setSavedSnapshot(localSnapshot);
      setContextLabel(localSnapshot.title);
      if (record.pieceCid != null) {
        setRestorePieceCid(record.pieceCid);
      }
      setStatus("Local context loaded");
      return;
    }

    if (record.pieceCid != null) {
      setRestorePieceCid(record.pieceCid);
      await runAction(() => restoreConversation(record.pieceCid ?? ""), "restore");
    }
  }

  async function runAction(action: () => Promise<void>, actionName: Exclude<ActiveAction, null>) {
    if (activeAction != null) {
      return;
    }

    setActiveAction(actionName);
    setBusyStartedAt(Date.now());
    setElapsedSeconds(0);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("Needs attention");
    } finally {
      setActiveAction(null);
      setBusyStartedAt(null);
    }
  }

  async function copyToClipboard(value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => {
      setCopiedValue((current) => (current === value ? null : current));
    }, 1400);
  }

  function upsertBlackBoxRecord(record: BlackBoxRecord, account = requireWalletStorageAccount()) {
    setBlackBoxes((current) => {
      const next = [record, ...current.filter((item) => item.id !== record.id)].slice(0, 12);
      window.localStorage.setItem(getBlackBoxIndexKey(account), JSON.stringify(next));
      return next;
    });
  }

  function updateBlackBoxNote(id: string, nextNote: string) {
    const storageAccount = requireWalletStorageAccount();
    setBlackBoxes((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, note: nextNote } : item));
      window.localStorage.setItem(getBlackBoxIndexKey(storageAccount), JSON.stringify(next));
      return next;
    });

    const localSnapshot = loadLocalSnapshot(storageAccount, id);
    if (localSnapshot != null) {
      persistSnapshot(storageAccount, { ...localSnapshot, note: nextNote });
    }

    if (savedSnapshot?.conversationId === id) {
      setSavedSnapshot((current) => (current == null ? current : { ...current, note: nextNote }));
      setNote(nextNote);
    }
  }

  function requireWalletStorageAccount() {
    if (walletAccount == null) {
      throw new Error("Connect MetaMask before saving or loading wallet-scoped black boxes.");
    }

    return walletAccount;
  }

  async function ensureWalletStorageAccount() {
    if (walletAccount != null) {
      return walletAccount;
    }

    const connectedWallet = await connectBrowserWallet();
    setWallet(connectedWallet);
    return connectedWallet.account.toLowerCase();
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Filecoin Onchain Cloud</p>
          <h1>Agent Black Box</h1>
        </div>
        <div className="status-stack" aria-live="polite">
          <div className="wallet-actions">
            <button
              className="wallet-button topbar-wallet"
              type="button"
              disabled={isBusy}
              onClick={() => runAction(connectWallet, "health")}
            >
              <span className="wallet-mark" aria-hidden="true" />
              {wallet == null ? "Connect MetaMask" : `MetaMask ${shorten(wallet.account)}`}
            </button>
            {wallet != null ? (
              <button className="disconnect-wallet" type="button" disabled={isBusy} onClick={disconnectWallet}>
                Disconnect
              </button>
            ) : null}
          </div>
          <div className="status-card" data-busy={isBusy}>
            <span>Status</span>
            <strong>{status}</strong>
          </div>
          {wallet != null ? <p>Wallet {shorten(wallet.account)} on {wallet.chain.name}</p> : null}
          {statusDetail != null ? <p>{statusDetail}</p> : null}
        </div>
      </section>

      <section className="workspace">
        <section className="panel task-panel conversation-panel">
          <div className="task-panel-heading">
            <p className="eyebrow">Conversation black box</p>
            <h2>Save a useful exchange, then decide whether to seal it.</h2>
          </div>

          {contextLabel != null ? <div className="context-ribbon">Using restored context: {contextLabel}</div> : null}

          <div className="conversation-shell">
            <aside className="memory-sidebar" aria-label="Saved conversation shortcuts">
              <span>Saved</span>
              {blackBoxes.length === 0 ? (
                <p>{walletAccount == null ? "Connect MetaMask to load wallet-scoped conversations." : "No saved conversations."}</p>
              ) : (
                blackBoxes.map((record) => (
                  <button type="button" disabled={isBusy} key={record.id} onClick={() => loadBlackBox(record)}>
                    {record.note.trim().length > 0 ? record.note.trim() : record.title}
                  </button>
                ))
              )}
            </aside>

            <div className="conversation-main">
              <div className="chat-window" aria-label="Conversation">
                {messages.length === 0 ? (
                  <div className="chat-empty">
                    <p>Start a short conversation. When it becomes useful, save it as a black box and optionally upload it to FOC.</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <article className="chat-message" data-role={message.role} key={message.id}>
                      <span>{message.role}</span>
                      <p>{message.text}</p>
                      {message.images.length > 0 ? (
                        <div className="message-images">
                          {message.images.map((image) => (
                            <figure key={image.id}>
                              <img alt={image.name} src={image.dataUrl} />
                              <figcaption>{image.name}</figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))
                )}
              </div>

              {attachments.length > 0 ? (
                <div className="attachment-tray" aria-label="Pending image attachments">
                  {attachments.map((image) => (
                    <figure key={image.id}>
                      <img alt={image.name} src={image.dataUrl} />
                      <figcaption>{image.name}</figcaption>
                      <button type="button" onClick={() => removeAttachment(image.id)}>
                        Remove
                      </button>
                    </figure>
                  ))}
                </div>
              ) : null}

              <textarea
                className="task-input"
                data-dragging={isDraggingFiles}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onDragLeave={leaveDraggedFiles}
                onDragOver={dragFilesOverInput}
                onDrop={dropFilesOnInput}
                onPaste={pasteImages}
                placeholder="Type here, paste a screenshot, or drop image files into this box."
              />
              <div className="task-actions conversation-actions">
                <label className="attach-button">
                  Add images
                  <input accept="image/*" multiple type="file" onChange={(event) => attachImages(event.target.files)} />
                </label>
                <button type="button" disabled={isBusy} onClick={() => runAction(sendMessage, "chat")}>
                  {activeAction === "chat" ? "Thinking" : "Send"}
                </button>
                <button type="button" disabled={messages.length === 0 || walletAccount == null} onClick={saveBlackBox}>
                  Save Black Box
                </button>
                <button type="button" onClick={startNewConversation}>
                  New Conversation
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="panel model-panel">
          <div className="panel-heading">
            <div>
              <h2>AI Models</h2>
              <p>{activeAiConfig == null ? "No model selected. The app will use the local demo reply." : `Using ${activeAiConfig.model}`}</p>
            </div>
          </div>
          <div className="model-form">
            <input
              value={aiForm.baseUrl}
              onChange={(event) => setAiForm((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder="API URL, e.g. https://api.openai.com/v1"
            />
            <input
              type="password"
              value={aiForm.apiKey}
              onChange={(event) => setAiForm((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder="API key"
            />
            <button type="button" disabled={isLoadingModels} onClick={loadAiModels}>
              {isLoadingModels ? "Loading" : "Load Models"}
            </button>
            <select
              value={aiForm.model}
              disabled={availableModels.length === 0}
              onChange={(event) => setAiForm((current) => ({ ...current, model: event.target.value }))}
            >
              {availableModels.length === 0 ? (
                <option value="">Load models first</option>
              ) : (
                availableModels.map((model) => (
                  <option value={model} key={model}>
                    {model}
                  </option>
                ))
              )}
            </select>
            <button type="button" onClick={saveAiConfig}>
              Add Model
            </button>
          </div>
          {aiConfigs.length > 0 ? (
            <div className="model-list" aria-label="AI model configs">
              {aiConfigs.map((config) => (
                <article data-active={config.id === activeAiConfigId} key={config.id}>
                  <div>
                    <strong>{config.model}</strong>
                    <small>{config.baseUrl}</small>
                  </div>
                  <button type="button" onClick={() => useAiConfig(config)}>
                    Use
                  </button>
                  <button type="button" onClick={() => removeAiConfig(config.id)}>
                    Remove
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section className="panel restore-panel">
          <div className="panel-heading">
            <h2>Restore Context</h2>
          </div>
          <div className="restore-field">
            <input
              value={restorePieceCid}
              onChange={(event) => setRestorePieceCid(event.target.value)}
              placeholder="Paste a conversation PieceCID"
            />
            <button type="button" disabled={isBusy} onClick={() => runAction(() => restoreConversation(), "restore")}>
              {activeAction === "restore" ? "Restoring" : "Restore"}
            </button>
          </div>
          <p className="helper-text">Restore a conversation black box by PieceCID, then continue with it as context.</p>
        </section>

        {error != null ? <div className="error-box">{error}</div> : null}

        <section className="trace-surface">
          <div className="trace-header">
            <h2>Saved Black Boxes</h2>
            <span>
              {blackBoxes.length} local records / {messages.length} messages / {imageCount} images
            </span>
          </div>

          {activeAction === "upload" || uploadEvents.length > 0 || sealedReceipt != null ? (
            <div className="seal-progress" aria-label="FOC upload monitor">
              <div>
                <span>FOC upload monitor</span>
                <strong>{formatElapsed(elapsedSeconds)}</strong>
              </div>
              {uploadEvents.length > 0 ? (
                <div className="upload-events">
                  {uploadEvents.map((item) => (
                    <p key={item.id}>{formatUploadEvent(item.event)}</p>
                  ))}
                </div>
              ) : null}
              {sealedReceipt != null ? (
                <div className="run-summary">
                  <span>{sealedReceipt.complete === false ? "Message submitted" : "Stored receipt"}</span>
                  <CopyableCode value={sealedReceipt.pieceCid} copied={copiedValue === sealedReceipt.pieceCid} onCopy={copyToClipboard} />
                </div>
              ) : null}
            </div>
          ) : null}

          {blackBoxes.length === 0 ? (
            <div className="empty-state">
              <p>No black boxes saved yet.</p>
            </div>
          ) : (
            <div className="memory-list">
              {blackBoxes.map((record) => (
                <article className="memory-card" key={record.id}>
                  <div>
                    <span>{record.pieceCid == null ? "local draft" : "FOC sealed"}</span>
                    <h3>{record.title}</h3>
                    <small>
                      {record.messageCount} messages / {record.imageCount} images
                    </small>
                  </div>
                  <label className="memory-note">
                    Note
                    <textarea value={record.note} onChange={(event) => updateBlackBoxNote(record.id, event.target.value)} />
                  </label>
                  <div className="memory-actions">
                    {record.pieceCid == null ? (
                      <button
                        className="primary"
                        type="button"
                        disabled={isBusy || walletAccount == null}
                        onClick={() => runAction(() => uploadBlackBoxRecord(record), "upload")}
                      >
                        {activeAction === "upload" ? "Uploading" : "Upload to FOC"}
                      </button>
                    ) : (
                      <>
                        <CopyableCode value={record.pieceCid} copied={copiedValue === record.pieceCid} onCopy={copyToClipboard} />
                        <small>Local conversation cache removed after upload.</small>
                      </>
                    )}
                    <button type="button" disabled={isBusy} onClick={() => loadBlackBox(record)}>
                      Use as Context
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      {health != null && showHealthPopover ? (
        <aside className="health-popover" aria-label="FOC State">
          <div className="health-popover-heading">
            <div>
              <span>FOC State</span>
              <h2>{health.chain.name}</h2>
            </div>
            <button type="button" aria-label="Close FOC State" onClick={() => setShowHealthPopover(false)}>
              x
            </button>
          </div>
          <dl>
            <dt>Account</dt>
            <dd>{shorten(health.account)}</dd>
            <dt>Balance</dt>
            <dd>{health.balance}</dd>
            <dt>Providers</dt>
            <dd>{health.storage.providers}</dd>
            <dt>Allowance</dt>
            <dd>{health.storage.allowanceApproved ? "approved" : "missing"}</dd>
          </dl>
        </aside>
      ) : null}
    </main>
  );
}

function createSnapshot(messages: ConversationMessage[], note: string): ConversationSnapshot {
  if (messages.length === 0) {
    throw new Error("Send at least one message before saving a black box.");
  }

  const firstUserMessage = messages.find((message) => message.role === "user");
  const titleSource = firstUserMessage?.text.trim() || "Image conversation";

  return {
    capsuleVersion: "conversation-1",
    conversationId: crypto.randomUUID(),
    title: titleSource.length > 72 ? `${titleSource.slice(0, 69)}...` : titleSource,
    note,
    messages,
    createdAt: new Date().toISOString(),
    metadata: {
      app: "agent-black-box",
      messageCount: messages.length,
      imageCount: messages.reduce((total, message) => total + message.images.length, 0)
    }
  };
}

function createRecord(snapshot: ConversationSnapshot, receipt: FilecoinReceipt | null): BlackBoxRecord {
  return {
    id: snapshot.conversationId,
    title: snapshot.title,
    note: snapshot.note,
    pieceCid: receipt?.pieceCid ?? null,
    createdAt: snapshot.createdAt,
    uploadedAt: receipt?.uploadedAt ?? null,
    messageCount: snapshot.messages.length,
    imageCount: snapshot.messages.reduce((total, message) => total + message.images.length, 0)
  };
}

function getBlackBoxIndexKey(account: string) {
  return `${blackBoxIndexKey}:${account}`;
}

function getSnapshotStorageKey(account: string, id: string) {
  return `${blackBoxSnapshotPrefix}${account}:${id}`;
}

function persistSnapshot(account: string, snapshot: ConversationSnapshot) {
  window.localStorage.setItem(getSnapshotStorageKey(account, snapshot.conversationId), JSON.stringify(snapshot));
}

function loadLocalSnapshot(account: string, id: string) {
  const stored = window.localStorage.getItem(getSnapshotStorageKey(account, id));
  return stored == null ? null : (JSON.parse(stored) as ConversationSnapshot);
}

function removeLocalSnapshot(account: string, id: string) {
  window.localStorage.removeItem(getSnapshotStorageKey(account, id));
}

function buildAssistantReply(text: string, images: ConversationImage[], contextLabel: string | null) {
  const subject = text.length > 0 ? text : "the attached image";
  const imageLine = images.length > 0 ? ` I also see ${images.length} image attachment${images.length === 1 ? "" : "s"} in this turn.` : "";
  const contextLine = contextLabel == null ? "" : ` I am using "${contextLabel}" as restored context.`;

  return `Captured: ${subject}.${imageLine}${contextLine} When this exchange becomes useful, save it as a black box, add a note, then upload it to FOC so the PieceCID can restore the conversation later.`;
}

async function requestAiAnswer(config: AiModelConfig, messages: ConversationMessage[]) {
  const response = await fetch("/api/ai-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      messages: messages.map((message) => ({
        role: message.role,
        text: message.text,
        images: message.images.map((image) => ({
          name: image.name,
          dataUrl: image.dataUrl
        }))
      }))
    })
  });
  const data = (await response.json()) as { answer?: string; error?: unknown };

  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? data));
  }

  return data.answer?.trim() || "The model returned an empty answer.";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error(`Failed to read ${file.name}`)));
    reader.readAsDataURL(file);
  });
}

function shorten(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function describeUploadEvent(event: JsonUploadLifecycleEvent) {
  switch (event.type) {
    case "progress":
      return "Uploading bytes";
    case "stored":
      return `Stored by provider ${event.providerId}`;
    case "pieces-added":
      return "Filecoin message submitted";
    case "pieces-confirmed":
      return "Filecoin message confirmed";
    case "copy-complete":
      return `Copy complete on provider ${event.providerId}`;
    case "copy-failed":
      return `Copy failed on provider ${event.providerId}`;
    case "pull-progress":
      return `Provider pull ${event.status}`;
  }
}

function formatUploadEvent(event: JsonUploadLifecycleEvent) {
  switch (event.type) {
    case "progress":
      return `uploaded ${event.bytesUploaded} bytes`;
    case "stored":
      return `stored ${shortCid(event.pieceCid)} on provider ${event.providerId}`;
    case "pieces-added":
      return `message submitted: ${shortHash(event.transaction)}`;
    case "pieces-confirmed":
      return `message confirmed in dataset ${event.dataSetId}`;
    case "copy-complete":
      return `copy complete: ${shortCid(event.pieceCid)}`;
    case "copy-failed":
      return `copy failed: ${event.error}`;
    case "pull-progress":
      return `provider pull ${event.status}`;
  }
}

function shortCid(value: string | undefined) {
  if (value == null || value.length <= 18) {
    return value ?? "";
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function shortHash(value: string | undefined) {
  if (value == null || value.length <= 16) {
    return value ?? "";
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function getStatusDetail(activeAction: ActiveAction) {
  switch (activeAction) {
    case "health":
      return "Reading account, balance, providers, and storage allowance.";
    case "chat":
      return "Calling the selected AI model.";
    case "upload":
      return "Uploading the saved conversation snapshot through Synapse SDK.";
    case "restore":
      return "Downloading a conversation black box by PieceCID.";
    default:
      return null;
  }
}

function CopyableCode({
  value,
  copied,
  onCopy
}: {
  value: string;
  copied: boolean;
  onCopy: (value: string) => Promise<void>;
}) {
  return (
    <div className="copyable-code">
      <code>{value}</code>
      <button type="button" onClick={() => onCopy(value)}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
