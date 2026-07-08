import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type LocalModelConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
};

export type LocalBlackBoxRecord = {
  id: string;
  title: string;
  note: string;
  pieceCid: string | null;
  createdAt: string;
  uploadedAt: string | null;
  messageCount: number;
  imageCount: number;
};

export type LocalState = {
  aiModels: {
    configs: LocalModelConfig[];
    activeConfigId: string | null;
  };
  walletRecords: Record<string, LocalBlackBoxRecord[]>;
};

const stateDirectory = join(process.cwd(), ".local-data");
const statePath = join(stateDirectory, "agent-black-box-state.json");
const canWriteLocalState = process.env.VERCEL == null && process.env.NETLIFY == null;

const defaultState: LocalState = {
  aiModels: {
    configs: [],
    activeConfigId: null
  },
  walletRecords: {}
};

export async function readLocalState(): Promise<LocalState> {
  if (!canWriteLocalState) {
    return defaultState;
  }

  try {
    const text = await readFile(statePath, "utf8");
    return {
      ...defaultState,
      ...(JSON.parse(text) as LocalState)
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return defaultState;
    }

    throw error;
  }
}

export async function writeLocalState(state: LocalState) {
  if (!canWriteLocalState) {
    void state;
    return;
  }

  await mkdir(stateDirectory, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isMissingFileError(error: unknown) {
  return typeof error === "object" && error != null && "code" in error && error.code === "ENOENT";
}
