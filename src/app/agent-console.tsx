"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
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

type RestoreProgress = {
  pieceCid: string;
  step: string;
  detail: string;
  phaseIndex: number;
  startedAt: number;
  finishedAt: number | null;
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
  const chatWindowRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);
  const [lastPersistedMessageSignature, setLastPersistedMessageSignature] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ConversationImage[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [note, setNote] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState<ConversationSnapshot | null>(null);
  const [blackBoxes, setBlackBoxes] = useState<BlackBoxRecord[]>([]);
  const [uploadedRecords, setUploadedRecords] = useState<BlackBoxRecord[]>([]);
  const [uploadedRecordsPage, setUploadedRecordsPage] = useState(0);
  const [uploadedRecordsPageSize, setUploadedRecordsPageSize] = useState(5);
  const [restorePieceCid, setRestorePieceCid] = useState("");
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null);
  const [restoreTick, setRestoreTick] = useState(0);
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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
      setUploadedRecords([]);
      setSavedSnapshot(null);
      setContextLabel(null);
      return;
    }

    applyWalletRecords(loadBlackBoxIndex(walletAccount));
    void fetch(`/api/local-state/wallet-records?wallet=${encodeURIComponent(walletAccount)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { records?: BlackBoxRecord[] } | null) => {
        if (data?.records == null) {
          return;
        }

        const merged = mergeRecords(loadBlackBoxIndex(walletAccount), data.records);
        writeBlackBoxIndex(walletAccount, merged);
        applyWalletRecords(merged);
      });
  }, [walletAccount]);

  useEffect(() => {
    const storedConfigs = window.localStorage.getItem(aiModelConfigKey);
    const storedActiveConfigId = window.localStorage.getItem(activeAiModelConfigKey);
    if (storedConfigs != null) {
      const parsedConfigs = JSON.parse(storedConfigs) as AiModelConfig[];
      setAiConfigs(parsedConfigs);
      setActiveAiConfigId(storedActiveConfigId ?? parsedConfigs[0]?.id ?? null);
    }
    void fetch("/api/local-state/models")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { configs?: AiModelConfig[]; activeConfigId?: string | null } | null) => {
        if (data?.configs == null || data.configs.length === 0) {
          return;
        }

        setAiConfigs(data.configs);
        setActiveAiConfigId(data.activeConfigId ?? data.configs[0]?.id ?? null);
        persistAiModelState(data.configs, data.activeConfigId ?? data.configs[0]?.id ?? null);
      });
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

  useEffect(() => {
    const chatWindow = chatWindowRef.current;
    if (chatWindow == null) {
      return;
    }

    chatWindow.scrollTo({
      top: chatWindow.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, pendingAssistantId]);

  useEffect(() => {
    if (restoreProgress == null || restoreProgress.finishedAt != null) {
      return;
    }

    const interval = window.setInterval(() => {
      setRestoreTick((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [restoreProgress]);

  const isBusy = activeAction != null;
  const isUploadBusy = activeAction === "upload";
  const isBlockingBusy = activeAction != null && activeAction !== "upload";
  const imageCount = useMemo(() => messages.reduce((total, message) => total + message.images.length, 0), [messages]);
  const currentMessageSignature = useMemo(() => messages.map((message) => message.id).join("|"), [messages]);
  const hasUnpersistedMessages = messages.length > 0 && currentMessageSignature !== lastPersistedMessageSignature;
  const localDraftCount = useMemo(() => blackBoxes.filter((record) => record.pieceCid == null).length, [blackBoxes]);
  const uploadedRecordsPageCount = Math.max(1, Math.ceil(uploadedRecords.length / uploadedRecordsPageSize));
  const visibleUploadedRecords = uploadedRecords.slice(
    uploadedRecordsPage * uploadedRecordsPageSize,
    uploadedRecordsPage * uploadedRecordsPageSize + uploadedRecordsPageSize
  );
  const statusDetail = getStatusDetail(activeAction);
  const activeAiConfig = aiConfigs.find((config) => config.id === activeAiConfigId) ?? null;
  const restoreElapsedSeconds = getRestoreElapsedSeconds(restoreProgress, restoreTick);
  const restoreProgressPercent = restoreProgress == null ? 0 : Math.round((restoreProgress.phaseIndex / 4) * 100);

  useEffect(() => {
    setUploadedRecordsPage((current) => Math.min(current, uploadedRecordsPageCount - 1));
  }, [uploadedRecordsPageCount]);

  function applyWalletRecords(records: BlackBoxRecord[]) {
    const localDrafts = records.filter((record) => record.pieceCid == null);
    setUploadedRecords(records.filter((record) => record.pieceCid != null));
    setBlackBoxes((current) => {
      const restoredOrCurrent = current.filter((record) => record.pieceCid != null);
      const restoredIds = new Set(restoredOrCurrent.map((record) => record.id));
      return [...restoredOrCurrent, ...localDrafts.filter((record) => !restoredIds.has(record.id))].slice(0, 12);
    });
  }

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
    setMessages([]);
    setPendingAssistantId(null);
    setLastPersistedMessageSignature("");
    setDraft("");
    setAttachments([]);
    setNote("");
    setBlackBoxes([]);
    setUploadedRecords([]);
    setSavedSnapshot(null);
    setSealedReceipt(null);
    setUploadEvents([]);
    setContextLabel(null);
    setRestorePieceCid("");
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
    const pendingAssistant: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: activeAiConfig == null ? "Preparing local demo reply..." : `Waiting for ${activeAiConfig.model}...`,
      images: [],
      createdAt: new Date().toISOString()
    };

    setPendingAssistantId(pendingAssistant.id);
    setMessages([...nextMessages, pendingAssistant]);
    setDraft("");
    setAttachments([]);
    setSavedSnapshot(null);
    setSealedReceipt(null);
    setStatus(activeAiConfig == null ? "Conversation updated" : `Calling ${activeAiConfig.model}`);

    let assistantText: string;
    try {
      assistantText =
        activeAiConfig == null
          ? buildAssistantReply(cleanDraft, attachments, contextLabel)
          : await requestAiAnswer(activeAiConfig, nextMessages);
    } catch (cause) {
      setPendingAssistantId(null);
      setMessages([
        ...nextMessages,
        {
          ...pendingAssistant,
          text: "AI reply failed. Check the selected model config and try again."
        }
      ]);
      throw cause;
    }
    const assistantMessage: ConversationMessage = {
      id: pendingAssistant.id,
      role: "assistant",
      text: assistantText,
      images: [],
      createdAt: new Date().toISOString()
    };

    setMessages([...nextMessages, assistantMessage]);
    setPendingAssistantId(null);
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

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submitChat();
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
    persistAiModelState(nextConfigs, config.id);
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
    persistAiModelState(aiConfigs, config.id);
    setStatus(`Using ${config.model}`);
  }

  function removeAiConfig(id: string) {
    const nextConfigs = aiConfigs.filter((config) => config.id !== id);
    const nextActiveId = activeAiConfigId === id ? nextConfigs[0]?.id ?? null : activeAiConfigId;
    setAiConfigs(nextConfigs);
    setActiveAiConfigId(nextActiveId);
    persistAiModelState(nextConfigs, nextActiveId);
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
    setLastPersistedMessageSignature(currentMessageSignature);
    setStatus("Black box saved locally");
  }

  function startNewConversation() {
    if (hasUnpersistedMessages) {
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
    setPendingAssistantId(null);
    setLastPersistedMessageSignature("");
    setDraft("");
    setAttachments([]);
    setNote("");
    setSavedSnapshot(null);
    setSealedReceipt(null);
    setUploadEvents([]);
    setContextLabel(null);
    setStatus(hasUnpersistedMessages ? "Previous black box saved locally" : "New conversation ready");
  }

  async function uploadBlackBoxRecord(record: BlackBoxRecord) {
    const storageAccount = requireWalletStorageAccount();
    const localSnapshot = loadLocalSnapshot(storageAccount, record.id);
    if (localSnapshot == null) {
      if (record.pieceCid != null) {
        await restoreContextNow(record.pieceCid);
        return;
      }

      throw new Error("This local draft is missing its browser cache. Save the conversation again before uploading it to FOC.");
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
      returnAfter: "complete",
      onUploadLifecycleEvent(event) {
        setUploadEvents((current) => [...current, { id: crypto.randomUUID(), event }].slice(-6));
        setStatus(describeUploadEvent(event));
      }
    });

    if ((result.receipt.chainTransactions?.length ?? 0) === 0) {
      setSealedReceipt(null);
      throw new Error("FOC returned a PieceCID without a chain transaction. The local draft was kept so you can retry.");
    }

    setSealedReceipt(result.receipt);
    setRestorePieceCid(result.receipt.pieceCid);
    upsertBlackBoxRecord(createRecord(snapshotWithCurrentNote, result.receipt));
    removeLocalSnapshot(storageAccount, record.id);
    if (savedSnapshot?.conversationId === record.id) {
      setSavedSnapshot(null);
    }
    setStatus(result.receipt.complete === false ? "Black box submitted; local cache removed" : "Black box sealed; local cache removed");
  }

  async function uploadAllLocalDrafts() {
    const drafts = blackBoxes.filter((record) => record.pieceCid == null);
    if (drafts.length === 0) {
      setStatus("No local drafts to upload");
      return;
    }

    for (const [index, record] of drafts.entries()) {
      setStatus(`Uploading draft ${index + 1}/${drafts.length}`);
      await uploadBlackBoxRecord(record);
    }

    setStatus(`Uploaded ${drafts.length} drafts to FOC`);
  }

  async function restoreConversation(pieceCid = restorePieceCid.trim()) {
    if (pieceCid.length === 0) {
      throw new Error("Enter a conversation PieceCID to restore.");
    }

    const startedAt = Date.now();
    setRestoreProgress({
      pieceCid,
      step: "Preparing wallet",
      detail: "Checking wallet permission and Filecoin network.",
      phaseIndex: 1,
      startedAt,
      finishedAt: null
    });
    setStatus("Restoring black box");
    setError(null);

    const storageAccount = await ensureWalletStorageAccount();
    setRestoreProgress((current) =>
      current == null
        ? current
        : {
            ...current,
            step: "Downloading from FOC",
            detail: "Fetching the conversation capsule by PieceCID.",
            phaseIndex: 2
          }
    );
    const restored = await restoreWalletBackedConversation(pieceCid);
    setRestoreProgress((current) =>
      current == null
        ? current
        : {
            ...current,
            step: "Parsing capsule",
            detail: "Validating the conversation payload and note.",
            phaseIndex: 3
          }
    );
    setMessages(restored.snapshot.messages);
    setLastPersistedMessageSignature(restored.snapshot.messages.map((message) => message.id).join("|"));
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
    setRestoreProgress((current) =>
      current == null
        ? current
        : {
            ...current,
            step: "Context loaded",
            detail: "Conversation restored and ready to use.",
            phaseIndex: 4,
            finishedAt: Date.now()
          }
    );
    setStatus("Context restored");
  }

  async function loadBlackBox(record: BlackBoxRecord) {
    const storageAccount = requireWalletStorageAccount();
    const localSnapshot = loadLocalSnapshot(storageAccount, record.id);
    if (localSnapshot != null) {
      setMessages(localSnapshot.messages);
      setLastPersistedMessageSignature(localSnapshot.messages.map((message) => message.id).join("|"));
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
      await restoreContextNow(record.pieceCid);
      return;
    }

    throw new Error("This local draft is missing its browser cache. Save the conversation again before using it as context.");
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

  async function submitChat() {
    if (pendingAssistantId != null) {
      return;
    }

    try {
      await sendMessage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("Needs attention");
    }
  }

  async function restoreContextNow(pieceCid: string) {
    try {
      await restoreConversation(pieceCid);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("Needs attention");
    }
  }

  async function useBlackBoxAsContext(record: BlackBoxRecord) {
    try {
      await loadBlackBox(record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("Needs attention");
    }
  }

  async function copyToClipboard(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1400);
  }

  function upsertBlackBoxRecord(record: BlackBoxRecord, account = requireWalletStorageAccount()) {
    const nextIndex = [record, ...loadBlackBoxIndex(account).filter((item) => item.id !== record.id)].slice(0, 24);
    writeBlackBoxIndex(account, nextIndex);
    setUploadedRecords(nextIndex.filter((item) => item.pieceCid != null));
    setBlackBoxes((current) => [record, ...current.filter((item) => item.id !== record.id)].slice(0, 12));
  }

  function updateBlackBoxNote(id: string, nextNote: string) {
    const storageAccount = requireWalletStorageAccount();
    const nextIndex = loadBlackBoxIndex(storageAccount).map((item) => (item.id === id ? { ...item, note: nextNote } : item));
    writeBlackBoxIndex(storageAccount, nextIndex);
    setUploadedRecords(nextIndex.filter((item) => item.pieceCid != null));
    setBlackBoxes((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, note: nextNote } : item));
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

  function deleteLocalDraft(record: BlackBoxRecord) {
    if (record.pieceCid != null) {
      return;
    }

    const storageAccount = requireWalletStorageAccount();
    removeLocalSnapshot(storageAccount, record.id);
    const nextIndex = loadBlackBoxIndex(storageAccount).filter((item) => item.id !== record.id);
    writeBlackBoxIndex(storageAccount, nextIndex);
    setBlackBoxes((current) => {
      const next = current.filter((item) => item.id !== record.id);
      return next;
    });
    setUploadedRecords(nextIndex.filter((item) => item.pieceCid != null));

    if (savedSnapshot?.conversationId === record.id) {
      setSavedSnapshot(null);
      setLastPersistedMessageSignature("");
    }

    setStatus("Local draft deleted");
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
          <p className="eyebrow">
            <img className="filecoin-icon" src="/filecoin.svg" alt="" aria-hidden="true" />
            Filecoin Onchain Cloud
          </p>
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
                  <button type="button" key={record.id} onClick={() => loadBlackBox(record)}>
                    {record.note.trim().length > 0 ? record.note.trim() : record.title}
                  </button>
                ))
              )}
            </aside>

            <div className="conversation-main">
              <div className="chat-window" aria-label="Conversation" ref={chatWindowRef}>
                {messages.length === 0 ? (
                  <div className="chat-empty">
                    <p>Start a short conversation. When it becomes useful, save it as a black box and optionally upload it to FOC.</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <article className="chat-message" data-role={message.role} key={message.id}>
                      <span>{message.role}</span>
                      <p data-pending={message.id === pendingAssistantId}>
                        {message.role === "assistant" ? formatAssistantDisplay(message.text) : message.text}
                      </p>
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
                onKeyDown={submitOnEnter}
                onPaste={pasteImages}
                placeholder="Type here, paste a screenshot, or drop image files into this box."
              />
              <div className="task-actions conversation-actions">
                <label className="attach-button">
                  Add images
                  <input accept="image/*" multiple type="file" onChange={(event) => attachImages(event.target.files)} />
                </label>
                <button type="button" disabled={pendingAssistantId != null} onClick={() => void submitChat()}>
                  {pendingAssistantId != null ? "Thinking" : "Send"}
                </button>
                <button type="button" disabled={isBlockingBusy || !hasUnpersistedMessages || walletAccount == null} onClick={saveBlackBox}>
                  Save Black Box
                </button>
                <button type="button" disabled={isBlockingBusy} onClick={startNewConversation}>
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
          {restoreProgress != null ? (
            <div className="restore-progress" aria-label="Restore progress">
              <div>
                <span>{restoreProgress.step}</span>
                <strong>{restoreProgressPercent}%</strong>
              </div>
              <div className="restore-progress-bar">
                <span style={{ width: `${restoreProgressPercent}%` }} />
              </div>
              <p>{restoreProgress.detail}</p>
              <small>Restore elapsed: {formatElapsed(restoreElapsedSeconds)}</small>
            </div>
          ) : null}
          {uploadedRecords.length > 0 ? (
            <div className="uploaded-records" aria-label="Uploaded PieceCID records">
              <div className="uploaded-records-heading">
                <span>Uploaded Records</span>
                <div>
                  <label>
                    Per page
                    <select
                      value={uploadedRecordsPageSize}
                      onChange={(event) => {
                        setUploadedRecordsPageSize(Number(event.target.value));
                        setUploadedRecordsPage(0);
                      }}
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                    </select>
                  </label>
                  <button type="button" disabled={uploadedRecordsPage === 0} onClick={() => setUploadedRecordsPage((current) => current - 1)}>
                    Prev
                  </button>
                  <small>
                    {uploadedRecordsPage + 1}/{uploadedRecordsPageCount}
                  </small>
                  <button
                    type="button"
                    disabled={uploadedRecordsPage >= uploadedRecordsPageCount - 1}
                    onClick={() => setUploadedRecordsPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
              {visibleUploadedRecords.map((record) =>
                record.pieceCid == null ? null : (
                  <article key={record.id}>
                    <div>
                      <strong>{record.note.trim().length > 0 ? record.note.trim() : record.title}</strong>
                      <small>
                        {record.messageCount} messages / {record.imageCount} images
                      </small>
                    </div>
                    <CopyableCode
                      value={record.pieceCid}
                      copyKey={`uploaded-${record.id}`}
                      copied={copiedKey === `uploaded-${record.id}`}
                      onCopy={copyToClipboard}
                    />
                    <button type="button" onClick={() => void restoreContextNow(record.pieceCid ?? "")}>
                      Restore
                    </button>
                  </article>
                )
              )}
            </div>
          ) : null}
        </section>

        {error != null ? <div className="error-box">{error}</div> : null}

        <section className="trace-surface">
          <div className="trace-header">
            <h2>Saved Black Boxes</h2>
            <div className="trace-header-actions">
              <span>
                {blackBoxes.length} local records / {messages.length} messages / {imageCount} images
              </span>
              {localDraftCount > 0 ? (
                <button
                  className="foc-button"
                  type="button"
                  disabled={isUploadBusy || walletAccount == null}
                  onClick={() => runAction(uploadAllLocalDrafts, "upload")}
                >
                  <img src="/filecoin.svg" alt="" aria-hidden="true" />
                  <span>{isUploadBusy ? "Uploading" : `Upload All Drafts (${localDraftCount})`}</span>
                </button>
              ) : null}
            </div>
          </div>

          {activeAction === "upload" || uploadEvents.length > 0 || sealedReceipt != null ? (
            <div className="seal-progress" aria-label="FOC upload monitor">
              <div>
                <span>FOC upload monitor</span>
                <strong>Upload elapsed: {formatElapsed(elapsedSeconds)}</strong>
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
                  <CopyableCode
                    value={sealedReceipt.pieceCid}
                    copyKey={`receipt-${sealedReceipt.pieceCid}`}
                    copied={copiedKey === `receipt-${sealedReceipt.pieceCid}`}
                    onCopy={copyToClipboard}
                  />
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
                      <>
                        <button
                          className="primary foc-button"
                          type="button"
                          disabled={isUploadBusy || walletAccount == null}
                          onClick={() => runAction(() => uploadBlackBoxRecord(record), "upload")}
                        >
                          <img src="/filecoin.svg" alt="" aria-hidden="true" />
                          <span>{activeAction === "upload" ? "Uploading" : "Upload to FOC"}</span>
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          disabled={isBusy || walletAccount == null}
                          onClick={() => deleteLocalDraft(record)}
                        >
                          Delete Draft
                        </button>
                      </>
                    ) : (
                      <>
                        <CopyableCode
                          value={record.pieceCid}
                          copyKey={`memory-${record.id}`}
                          copied={copiedKey === `memory-${record.id}`}
                          onCopy={copyToClipboard}
                        />
                        <small>Local conversation cache removed after upload.</small>
                      </>
                    )}
                    <button type="button" onClick={() => void useBlackBoxAsContext(record)}>
                      {record.pieceCid == null ? "Use as Context" : "Restore from FOC"}
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

function loadBlackBoxIndex(account: string) {
  const stored = window.localStorage.getItem(getBlackBoxIndexKey(account));
  return stored == null ? [] : (JSON.parse(stored) as BlackBoxRecord[]);
}

function mergeRecords(primary: BlackBoxRecord[], secondary: BlackBoxRecord[]) {
  const records = new Map<string, BlackBoxRecord>();
  for (const record of [...secondary, ...primary]) {
    records.set(record.id, record);
  }

  return Array.from(records.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 24);
}

function writeBlackBoxIndex(account: string, records: BlackBoxRecord[]) {
  window.localStorage.setItem(getBlackBoxIndexKey(account), JSON.stringify(records));
  void fetch("/api/local-state/wallet-records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      wallet: account,
      records
    })
  });
}

function persistAiModelState(configs: AiModelConfig[], activeConfigId: string | null) {
  window.localStorage.setItem(aiModelConfigKey, JSON.stringify(configs));
  if (activeConfigId == null) {
    window.localStorage.removeItem(activeAiModelConfigKey);
  } else {
    window.localStorage.setItem(activeAiModelConfigKey, activeConfigId);
  }

  void fetch("/api/local-state/models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      configs,
      activeConfigId
    })
  });
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

  return normalizeModelAnswer(data.answer?.trim() || "The model returned an empty answer.");
}

function normalizeModelAnswer(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+(#{1,4}\s+)/g, "\n\n$1")
    .replace(/[ \t]+(\d+\.\s+)/g, "\n\n$1")
    .replace(/[ \t]+-\s+/g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatAssistantDisplay(value: string) {
  return normalizeModelAnswer(value)
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\[ \]\s*/g, "")
    .trim();
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

function getRestoreElapsedSeconds(progress: RestoreProgress | null, tick: number) {
  void tick;

  if (progress == null) {
    return 0;
  }

  const end = progress.finishedAt ?? Date.now();
  return Math.max(0, Math.floor((end - progress.startedAt) / 1000));
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
  copyKey,
  copied,
  onCopy
}: {
  value: string;
  copyKey: string;
  copied: boolean;
  onCopy: (value: string, key: string) => Promise<void>;
}) {
  return (
    <div className="copyable-code">
      <code>{value}</code>
      <button type="button" data-copied={copied} aria-label={copied ? "Copied" : "Copy PieceCID"} onClick={() => onCopy(value, copyKey)}>
        <span>{copied ? "Copied!" : "Copy"}</span>
      </button>
    </div>
  );
}
