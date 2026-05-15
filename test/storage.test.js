import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("remembers recent branch and last selection", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lasso-storage-"));
  process.env.LASSO_DATA_DIR = tempDir;

  const storage = await import(`../src/storage.js?test=${Date.now()}`);
  await storage.rememberRunSelection({
    projectKey: "promotion",
    branchName: " feature/promo-42 ",
    mergePr: false,
    targets: ["web"],
    mode: "buildAndDeploy",
    browserExecutablePath: "C:\\Browser\\chrome.exe"
  });

  const state = await storage.loadState();
  assert.deepEqual(state.recentBranches, ["feature/promo-42"]);
  assert.equal(state.lastSelection.projectKey, "promotion");
  assert.equal(state.lastSelection.branchName, "feature/promo-42");
  assert.equal(state.lastSelection.mode, "buildAndDeploy");
  assert.equal(state.browserExecutablePath, "C:\\Browser\\chrome.exe");

  await fs.rm(tempDir, { recursive: true, force: true });
});
