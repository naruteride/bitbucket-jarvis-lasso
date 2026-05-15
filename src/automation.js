import fs from "node:fs/promises";
import path from "node:path";
import { BROWSER_PROFILE_DIR, PROJECTS, SCREENSHOT_DIR, detectBrowserExecutablePath } from "./config.js";

const SHORT_TIMEOUT = 5_000;
const MEDIUM_TIMEOUT = 15_000;
const LONG_TIMEOUT = 60_000;
const LOGIN_TIMEOUT = 10 * 60_000;

export async function runDeploymentFlow({ request, runId, signal, log }) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await fs.mkdir(BROWSER_PROFILE_DIR, { recursive: true });

  const { chromium } = await import("playwright-core");
  const browserExecutablePath = request.browserExecutablePath || detectBrowserExecutablePath();
  if (!browserExecutablePath) {
    throw new Error("Chrome 또는 Edge 실행 파일을 찾지 못했습니다. 패널의 브라우저 경로에 chrome.exe 또는 msedge.exe 경로를 입력하세요.");
  }

  log("info", "브라우저를 실행합니다.", { browserExecutablePath });
  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    executablePath: browserExecutablePath,
    headless: false,
    viewport: { width: 1360, height: 900 },
    args: ["--start-maximized"]
  });

  const page = context.pages()[0] || (await context.newPage());
  const project = PROJECTS[request.projectKey];

  try {
    if (request.mergePr) {
      assertNotAborted(signal);
      await runBitbucketMerge(page, project, request.branchName, log, signal, runId);
    } else {
      log("info", "PR 처리를 건너뜁니다.");
    }

    for (const targetKey of request.targets) {
      assertNotAborted(signal);
      const target = project.jarvis[targetKey];
      await runJarvisBuild(page, {
        targetKey,
        target,
        mode: request.mode,
        log,
        signal,
        runId
      });
    }
  } catch (error) {
    await attachFailureDetails(page, error, runId);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

async function runBitbucketMerge(page, project, branchName, log, signal, runId) {
  const step = "bitbucket-pr";
  log("info", "Bitbucket PR 생성 페이지로 이동합니다.", { url: project.bitbucket.url });
  await page.goto(project.bitbucket.url, { waitUntil: "domcontentloaded", timeout: LONG_TIMEOUT });
  await waitForLoginOrPage(page, "code.skplanet.com", log, signal);
  await page.waitForLoadState("networkidle", { timeout: LONG_TIMEOUT }).catch(() => {});

  assertNotAborted(signal);
  log("info", "source 브랜치를 선택합니다.", { branchName });
  await selectBitbucketBranch(page, branchName);

  assertNotAborted(signal);
  await clickButton(page, ["Continue", "계속", "다음"], "PR 비교를 계속할 수 없습니다.");
  await page.waitForLoadState("networkidle", { timeout: MEDIUM_TIMEOUT }).catch(() => {});

  assertNotAborted(signal);
  await clickButton(page, ["Create", "Create pull request", "생성"], "PR을 생성할 수 없습니다.");
  await page.waitForLoadState("networkidle", { timeout: LONG_TIMEOUT }).catch(() => {});

  assertNotAborted(signal);
  await clickButton(page, ["Merge", "머지", "병합"], "PR Merge 버튼을 찾을 수 없습니다.");
  await clickButton(page, ["Merge", "머지", "병합"], "Merge 확인 버튼을 찾을 수 없습니다.");
  await page.waitForLoadState("networkidle", { timeout: LONG_TIMEOUT }).catch(() => {});

  const signalText = await waitForAnyVisibleText(page, ["Merged", "merged", "머지", "병합"], MEDIUM_TIMEOUT).catch(() => "");
  log("success", "Bitbucket PR 머지 요청을 완료했습니다.", {
    branchName,
    signalText,
    screenshot: await saveStepScreenshot(page, runId, step)
  });
}

async function runJarvisBuild(page, { targetKey, target, mode, log, signal, runId }) {
  const step = `jarvis-${targetKey}`;
  log("info", `Jarvis ${target.label} 설정으로 이동합니다.`, { url: target.url });
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: LONG_TIMEOUT });
  await waitForLoginOrPage(page, "devjarvis.skplanet.com", log, signal);
  await page.waitForLoadState("networkidle", { timeout: LONG_TIMEOUT }).catch(() => {});

  assertNotAborted(signal);
  await clickButton(page, ["Build", "빌드"], `${target.label} Build 버튼을 찾을 수 없습니다.`);
  await page.waitForLoadState("networkidle", { timeout: MEDIUM_TIMEOUT }).catch(() => {});

  if (mode === "buildAndDeploy") {
    assertNotAborted(signal);
    log("info", `${target.label} 빌드 후 배포 옵션을 선택합니다.`, { deployLabel: target.deployLabel });
    await checkDeployAfterBuild(page, target.deployLabel);
  }

  assertNotAborted(signal);
  await clickButton(page, ["Build", "빌드"], `${target.label} 팝업의 Build 버튼을 찾을 수 없습니다.`);
  await page.waitForLoadState("networkidle", { timeout: LONG_TIMEOUT }).catch(() => {});

  const signalText = await detectJarvisAccepted(page);
  log("success", `${target.label} ${mode === "buildAndDeploy" ? "빌드/배포" : "빌드"} 요청이 접수되었습니다.`, {
    target: targetKey,
    mode,
    signalText,
    screenshot: await saveStepScreenshot(page, runId, step)
  });
}

async function selectBitbucketBranch(page, branchName) {
  const escapedBranch = escapeText(branchName);
  const selectors = [
    page.getByLabel("Source branch", { exact: false }),
    page.getByLabel("Source Branch", { exact: false }),
    page.getByLabel("From branch", { exact: false }),
    page.getByLabel("Branch", { exact: false }),
    page.getByRole("combobox", { name: "Source branch", exact: false }),
    page.getByRole("combobox", { name: "Branch", exact: false }),
    page.locator('input[placeholder*="branch" i]'),
    page.locator('input[aria-label*="branch" i]'),
    page.locator('[data-testid*="source" i] input'),
    page.locator('[data-testid*="branch" i] input')
  ];

  for (const locator of selectors) {
    if (await tryFillAndChooseBranch(locator, page, branchName)) {
      return;
    }
  }

  const branchButtonCandidates = [
    page.locator('button[aria-label*="source" i]'),
    page.locator('button[aria-label*="branch" i]'),
    page.locator('[data-testid*="source" i] button'),
    page.locator('[data-testid*="branch" i] button'),
    page.getByText("source", { exact: false }),
    page.getByText("branch", { exact: false })
  ];

  for (const locator of branchButtonCandidates) {
    if (await clickFirstVisible(locator)) {
      const search = page.locator('input[placeholder*="search" i], input[placeholder*="branch" i], input[type="search"], input');
      if (await tryFillAndChooseBranch(search, page, branchName)) {
        return;
      }
    }
  }

  const exactBranch = page.locator(`text="${escapedBranch}"`);
  if ((await exactBranch.count().catch(() => 0)) > 0) {
    await exactBranch.first().click({ timeout: SHORT_TIMEOUT });
    return;
  }

  throw new Error(`Bitbucket source 브랜치 선택에 실패했습니다: ${branchName}`);
}

async function tryFillAndChooseBranch(locator, page, branchName) {
  const count = await locator.count().catch(() => 0);
  if (!count) {
    return false;
  }

  for (let index = 0; index < Math.min(count, 4); index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    await candidate.click({ timeout: SHORT_TIMEOUT }).catch(() => {});
    await candidate.fill(branchName, { timeout: SHORT_TIMEOUT }).catch(async () => {
      await candidate.press(process.platform === "darwin" ? "Meta+A" : "Control+A", { timeout: SHORT_TIMEOUT }).catch(() => {});
      await candidate.type(branchName, { timeout: SHORT_TIMEOUT });
    });

    await page.waitForLoadState("networkidle", { timeout: SHORT_TIMEOUT }).catch(() => {});

    const optionCandidates = [
      page.getByRole("option", { name: branchName, exact: false }),
      page.getByText(branchName, { exact: true }),
      page.getByText(branchName, { exact: false })
    ];
    for (const option of optionCandidates) {
      if (await clickFirstVisible(option)) {
        return true;
      }
    }

    await candidate.press("Enter", { timeout: SHORT_TIMEOUT }).catch(() => {});
    return true;
  }

  return false;
}

async function checkDeployAfterBuild(page, deployLabel) {
  const labels = [
    `체크하면 빌드 후 자동으로 "${deployLabel}" 이/가 배포됩니다.`,
    deployLabel,
    "빌드 후 자동",
    "자동으로"
  ];

  for (const label of labels) {
    const byLabel = page.getByLabel(label, { exact: false });
    if ((await byLabel.count().catch(() => 0)) > 0) {
      await byLabel.first().setChecked(true, { timeout: SHORT_TIMEOUT }).catch(async () => {
        await byLabel.first().check({ timeout: SHORT_TIMEOUT });
      });
      return;
    }
  }

  const checkbox = page.locator('input[type="checkbox"], [role="checkbox"]');
  const count = await checkbox.count().catch(() => 0);
  if (count === 1) {
    await checkbox.first().setChecked(true, { timeout: SHORT_TIMEOUT }).catch(async () => {
      await checkbox.first().click({ timeout: SHORT_TIMEOUT });
    });
    return;
  }

  throw new Error(`Jarvis 배포 체크박스를 찾을 수 없습니다: ${deployLabel}`);
}

async function clickButton(page, labels, failureMessage) {
  for (const label of labels) {
    const locators = [
      page.getByRole("button", { name: label, exact: true }),
      page.getByRole("button", { name: label, exact: false }),
      page.locator(`button:has-text("${escapeText(label)}")`),
      page.locator(`[role="button"]:has-text("${escapeText(label)}")`),
      page.getByText(label, { exact: true })
    ];

    for (const locator of locators) {
      if (await clickFirstVisible(locator)) {
        return;
      }
    }
  }

  throw new Error(failureMessage);
}

async function clickFirstVisible(locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 5); index += 1) {
    const candidate = locator.nth(index);
    const visible = await candidate.isVisible().catch(() => false);
    const enabled = await candidate.isEnabled().catch(() => true);
    if (visible && enabled) {
      await candidate.click({ timeout: SHORT_TIMEOUT });
      return true;
    }
  }
  return false;
}

async function detectJarvisAccepted(page) {
  const selectors = [
    '[role="alert"]',
    ".toast",
    ".Toastify__toast",
    ".ant-message",
    ".ant-notification",
    ".alert",
    ".notification",
    ".message"
  ];
  const patterns = ["성공", "요청", "시작", "접수", "빌드", "Build", "build", "started", "queued"];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 5); index += 1) {
      const text = await locator.nth(index).innerText({ timeout: SHORT_TIMEOUT }).catch(() => "");
      if (patterns.some((pattern) => text.includes(pattern))) {
        return text.trim().slice(0, 300);
      }
    }
  }

  return waitForAnyVisibleText(page, patterns, MEDIUM_TIMEOUT).catch(() => "요청 접수 신호를 명확히 찾지 못했지만 Build 클릭은 완료되었습니다.");
}

async function waitForAnyVisibleText(page, texts, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    for (const text of texts) {
      const locator = page.getByText(text, { exact: false });
      const count = await locator.count().catch((error) => {
        lastError = error;
        return 0;
      });
      for (let index = 0; index < Math.min(count, 3); index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return (await candidate.innerText({ timeout: SHORT_TIMEOUT }).catch(() => text)).trim().slice(0, 300);
        }
      }
    }
    await page.waitForTimeout(500);
  }
  throw lastError || new Error("대기 중인 텍스트를 찾지 못했습니다.");
}

async function waitForLoginOrPage(page, expectedHost, log, signal) {
  const currentUrl = page.url();
  if (currentUrl.includes(expectedHost)) {
    return;
  }

  log("warn", "로그인이 필요할 수 있습니다. 열린 브라우저에서 SSO 로그인을 완료하면 자동으로 이어집니다.", {
    expectedHost,
    currentUrl
  });

  const deadline = Date.now() + LOGIN_TIMEOUT;
  while (Date.now() < deadline) {
    assertNotAborted(signal);
    if (page.url().includes(expectedHost)) {
      return;
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error(`로그인 대기 시간이 초과되었습니다: ${expectedHost}`);
}

async function attachFailureDetails(page, error, runId) {
  const details = {
    currentUrl: page.url(),
    screenshot: await saveStepScreenshot(page, runId, "failure").catch(() => "")
  };
  error.details = { ...(error.details || {}), ...details };
}

async function saveStepScreenshot(page, runId, step) {
  const safeStep = step.replace(/[^a-z0-9_-]/gi, "_");
  const filePath = path.join(SCREENSHOT_DIR, `${runId}-${safeStep}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

function assertNotAborted(signal) {
  if (signal.aborted) {
    throw new Error("작업이 취소되었습니다.");
  }
}

function escapeText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
