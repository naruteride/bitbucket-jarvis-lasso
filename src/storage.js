import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, DEFAULT_SELECTION, STATE_FILE } from "./config.js";

const DEFAULT_STATE = {
  recentBranches: [],
  lastSelection: DEFAULT_SELECTION,
  browserExecutablePath: ""
};

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadState() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Ignoring unreadable state file: ${error.message}`);
    }
    return structuredClone(DEFAULT_STATE);
  }
}

export async function saveState(state) {
  await ensureDataDir();
  const normalized = normalizeState(state);
  const tempPath = `${STATE_FILE}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, STATE_FILE);
  return normalized;
}

export async function rememberRunSelection(selection) {
  const state = await loadState();
  const branchName = selection.branchName.trim();
  const recentBranches = [branchName, ...state.recentBranches.filter((branch) => branch !== branchName)].slice(0, 12);

  return saveState({
    ...state,
    recentBranches,
    browserExecutablePath: selection.browserExecutablePath || state.browserExecutablePath || "",
    lastSelection: {
      projectKey: selection.projectKey,
      branchName,
      mergePr: selection.mergePr,
      targets: selection.targets,
      mode: selection.mode
    }
  });
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};
  const lastSelection = state.lastSelection && typeof state.lastSelection === "object" ? state.lastSelection : {};

  return {
    recentBranches: Array.isArray(state.recentBranches)
      ? state.recentBranches.filter((branch) => typeof branch === "string" && branch.trim()).slice(0, 12)
      : [],
    lastSelection: {
      ...DEFAULT_SELECTION,
      ...lastSelection,
      targets: Array.isArray(lastSelection.targets) && lastSelection.targets.length ? lastSelection.targets : DEFAULT_SELECTION.targets
    },
    browserExecutablePath: typeof state.browserExecutablePath === "string" ? state.browserExecutablePath : ""
  };
}

export function stateFilePath() {
  return path.resolve(STATE_FILE);
}
