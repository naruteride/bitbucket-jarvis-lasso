import fs from "node:fs/promises";
import path from "node:path";
import { BROWSER_PROFILE_DIR, PROJECTS, SCREENSHOT_DIR, detectBrowserExecutablePath } from "./config.js";

const SHORT_TIMEOUT = 5_000;
const MEDIUM_TIMEOUT = 15_000;
const LONG_TIMEOUT = 30_000;
const LOGIN_TIMEOUT = 5 * 60_000;
export const BITBUCKET_MERGE_CONFIRM_SELECTOR = '[role="dialog"] button.action-button';
export const JARVIS_STATUS_ICON_SELECTOR = "i.fas.fa-circle";
export const JARVIS_SUCCESS_CLASS = "deploy-status-0";
export const JARVIS_DEPLOY_STATUS_ICON_SELECTOR = JARVIS_STATUS_ICON_SELECTOR;
export const JARVIS_DEPLOY_SUCCESS_CLASS = JARVIS_SUCCESS_CLASS;
const JARVIS_STATUS_TIMEOUT = 10 * 60_000;

let retainedContext = null;

export async function runDeploymentFlow({ request, runId, signal, log }) {
	await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
	await fs.mkdir(BROWSER_PROFILE_DIR, { recursive: true });

	const { chromium } = await import("playwright-core");
	const browserExecutablePath = request.browserExecutablePath || detectBrowserExecutablePath();
	if (!browserExecutablePath) {
		throw new Error("Chrome 또는 Edge 실행 파일을 찾지 못했습니다. 패널의 브라우저 경로에 chrome.exe 또는 msedge.exe 경로를 입력하세요.");
	}

	log("info", "브라우저를 실행합니다.", {
		browserExecutablePath,
		browserProfileDir: BROWSER_PROFILE_DIR
	});
	log("info", "자동화 창은 일반 Chrome 로그인과 별도의 전용 프로필을 사용합니다. 로그인 화면이 보이면 이 창에서 SSO 로그인을 완료한 뒤 다시 실행하세요.");
	const context = await getAutomationContext(chromium, browserExecutablePath, log);

	const page = context.pages()[0] || (await context.newPage());
	const project = PROJECTS[request.projectKey];
	const stepDelayMs = toStepDelayMs(request.stepDelaySeconds);
	let keepBrowserOpen = false;

	try {
		if (request.mergePr) {
			assertNotAborted(signal);
			await runBitbucketMerge(page, project, request.branchName, log, signal, runId, stepDelayMs);
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
				runId,
				stepDelayMs
			});
		}
	} catch (error) {
		await attachFailureDetails(page, error, runId);
		keepBrowserOpen = !signal.aborted;
		if (keepBrowserOpen) {
			retainedContext = context;
			log("warn", "실패 상태를 확인할 수 있도록 브라우저 창을 닫지 않습니다.", {
				currentUrl: page.url(),
				browserProfileDir: BROWSER_PROFILE_DIR
			});
			error.details = {
				...(error.details || {}),
				browserLeftOpen: true,
				browserProfileDir: BROWSER_PROFILE_DIR
			};
		}
		throw error;
	} finally {
		if (!keepBrowserOpen) {
			if (retainedContext === context) {
				retainedContext = null;
			}
			await context.close().catch(() => { });
		}
	}
}

async function getAutomationContext(chromium, browserExecutablePath, log) {
	if (retainedContext) {
		try {
			const pages = retainedContext.pages().filter((page) => !page.isClosed());
			if (pages.length === 0) {
				await retainedContext.newPage();
			}
			log("info", "이전 실패에서 남겨둔 브라우저 창을 재사용합니다.");
			return retainedContext;
		} catch (error) {
			retainedContext = null;
			log("warn", "이전 실패에서 남겨둔 브라우저를 찾을 수 없어 새 브라우저 창을 실행합니다.", {
				reason: error.message
			});
		}
	}

	log("info", "새 브라우저 창을 실행합니다.");
	return chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
		executablePath: browserExecutablePath,
		headless: false,
		viewport: { width: 1360, height: 900 },
		args: ["--start-maximized"]
	});
}

function toStepDelayMs(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return 1_000;
	}
	return Math.min(30_000, Math.max(0, numeric * 1_000));
}

async function waitStepDelay(page, delayMs, log, label, signal) {
	assertNotAborted(signal);
	if (!delayMs) {
		return;
	}
	await page.waitForTimeout(delayMs);
	assertNotAborted(signal);
}

async function runBitbucketMerge(page, project, branchName, log, signal, runId, stepDelayMs) {
	const step = "bitbucket-pr";
	const pullRequestUrl = buildBitbucketPullRequestUrl(project.bitbucket.url, branchName);
	log("info", "Bitbucket PR 생성 페이지로 이동합니다.", { url: pullRequestUrl });
	await page.goto(pullRequestUrl, { waitUntil: "domcontentloaded", timeout: MEDIUM_TIMEOUT });
	await waitForLoginOrPage(page, "code.skplanet.com", log, signal);
	await page.waitForLoadState("networkidle", { timeout: LONG_TIMEOUT }).catch(() => { });
	await waitStepDelay(page, stepDelayMs, log, "Bitbucket PR 페이지 로드 후", signal);

	assertNotAborted(signal);
	await clickContinueOrSelectBranch(page, branchName, log);
	await page.waitForLoadState("networkidle", { timeout: MEDIUM_TIMEOUT }).catch(() => { });
	await waitStepDelay(page, stepDelayMs, log, "PR Continue 후", signal);

	assertNotAborted(signal);
	await clickButton(page, ["Create", "Create pull request", "생성"], "PR을 생성할 수 없습니다.");
	await page.waitForLoadState("networkidle", { timeout: LONG_TIMEOUT }).catch(() => { });
	await waitStepDelay(page, stepDelayMs, log, "PR Create 후", signal);

	assertNotAborted(signal);
	await clickButton(page, ["Merge", "머지", "병합"], "PR Merge 버튼을 찾을 수 없습니다.");
	await waitStepDelay(page, stepDelayMs, log, "PR Merge 모달 표시 후", signal);

	assertNotAborted(signal);
	await clickBitbucketMergeConfirm(page);
	await page.waitForLoadState("networkidle", { timeout: MEDIUM_TIMEOUT }).catch(() => { });
	await waitStepDelay(page, stepDelayMs, log, "PR Merge 확인 후", signal);

	const signalText = await waitForAnyVisibleText(page, ["Merged", "merged", "머지", "병합"], MEDIUM_TIMEOUT).catch(() => "");
	log("success", "Bitbucket PR 머지 요청을 완료했습니다.", {
		branchName,
		signalText,
		screenshot: await saveStepScreenshot(page, runId, step)
	});
}

export function buildBitbucketPullRequestUrl(baseUrl, branchName) {
	const sourceBranchParam = `sourceBranch=${encodeURIComponent(`refs/heads/${normalizeBranchName(branchName)}`)}`;
	if (/[?&]sourceBranch=/.test(baseUrl)) {
		return baseUrl.replace(/([?&])sourceBranch=[^&]*/u, `$1${sourceBranchParam}`);
	}
	if (/[?&]activeTab=/.test(baseUrl)) {
		return baseUrl.replace(/([?&]activeTab=[^&]*)/u, `$1&${sourceBranchParam}`);
	}
	return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${sourceBranchParam}`;
}

async function clickContinueOrSelectBranch(page, branchName, log) {
	try {
		await clickButton(page, ["Continue", "계속", "다음"], "PR 비교를 계속할 수 없습니다.");
	} catch (error) {
		log("warn", "URL sourceBranch 적용만으로 Continue가 불가능해 UI에서 source 브랜치를 선택합니다.", {
			branchName,
			reason: error.message
		});
		await selectBitbucketBranch(page, branchName);
		await clickButton(page, ["Continue", "계속", "다음"], "PR 비교를 계속할 수 없습니다.");
	}
}

async function clickBitbucketMergeConfirm(page) {
	const dialogAction = page.locator(BITBUCKET_MERGE_CONFIRM_SELECTOR);
	await dialogAction.first().waitFor({ state: "visible", timeout: MEDIUM_TIMEOUT }).catch(() => { });
	if (await clickFirstVisible(dialogAction)) {
		return;
	}

	const dialogButtons = [
		page.locator('[role="dialog"] button:has-text("Merge")'),
		page.locator('[role="dialog"] button:has-text("머지")'),
		page.locator('[role="dialog"] button:has-text("병합")')
	];
	for (const locator of dialogButtons) {
		if (await clickFirstVisible(locator)) {
			return;
		}
	}

	await clickButton(page, ["Merge", "머지", "병합"], "Merge 확인 버튼을 찾을 수 없습니다.");
}

function normalizeBranchName(branchName) {
	return String(branchName).trim().replace(/^refs\/heads\//i, "");
}

async function runJarvisBuild(page, { targetKey, target, mode, log, signal, runId, stepDelayMs }) {
	const step = `jarvis-${targetKey}`;
	log("info", `Jarvis ${target.label} 설정으로 이동합니다.`, { url: target.url });
	await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: LONG_TIMEOUT });
	await waitForLoginOrPage(page, "devjarvis.skplanet.com", log, signal);
	await page.waitForLoadState("networkidle", { timeout: SHORT_TIMEOUT }).catch(() => { });
	await waitStepDelay(page, stepDelayMs, log, `${target.label} Jarvis 페이지 로드 후`, signal);

	assertNotAborted(signal);
	await clickButton(page, ["Build", "빌드"], `${target.label} Build 버튼을 찾을 수 없습니다.`);
	await page.waitForLoadState("networkidle", { timeout: SHORT_TIMEOUT }).catch(() => { });
	await waitStepDelay(page, stepDelayMs, log, `${target.label} Build 팝업 표시 후`, signal);

	if (mode === "buildAndDeploy") {
		assertNotAborted(signal);
		log("info", `${target.label} 빌드 후 배포 옵션을 선택합니다.`, { deployLabel: target.deployLabel });
		await checkDeployAfterBuild(page, target.deployLabel);
		await waitStepDelay(page, stepDelayMs, log, `${target.label} 배포 옵션 선택 후`, signal);
	}

	assertNotAborted(signal);
	await clickButton(page, ["Build", "빌드"], `${target.label} 팝업의 Build 버튼을 찾을 수 없습니다.`);
	await page.waitForLoadState("networkidle", { timeout: MEDIUM_TIMEOUT }).catch(() => { });
	await waitStepDelay(page, stepDelayMs, log, `${target.label} Build 요청 후`, signal);

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

		await candidate.click({ timeout: SHORT_TIMEOUT }).catch(() => { });
		await candidate.fill(branchName, { timeout: SHORT_TIMEOUT }).catch(async () => {
			await candidate.press(process.platform === "darwin" ? "Meta+A" : "Control+A", { timeout: SHORT_TIMEOUT }).catch(() => { });
			await candidate.type(branchName, { timeout: SHORT_TIMEOUT });
		});

		await page.waitForLoadState("networkidle", { timeout: SHORT_TIMEOUT }).catch(() => { });

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

		await candidate.press("Enter", { timeout: SHORT_TIMEOUT }).catch(() => { });
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
	return waitForFirstJarvisBuildOrDeploySuccess(page);
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

async function waitForFirstJarvisBuildOrDeploySuccess(page) {
	const deadline = Date.now() + JARVIS_STATUS_TIMEOUT;
	let lastClassName = "";
	let lastErrorMessage = "";

	while (Date.now() < deadline) {
		const icon = page.locator(JARVIS_STATUS_ICON_SELECTOR).first();
		const iconCount = await page.locator(JARVIS_STATUS_ICON_SELECTOR).count().catch((error) => {
			lastErrorMessage = error.message;
			return 0;
		});

		if (iconCount > 0) {
			const parent = icon.locator("xpath=..");
			lastClassName = (await parent.getAttribute("class", { timeout: SHORT_TIMEOUT }).catch((error) => {
				lastErrorMessage = error.message;
				return "";
			})) || "";

			if (hasJarvisSuccessClass(lastClassName)) {
				return `Jarvis status is ${JARVIS_SUCCESS_CLASS}.`;
			}
		}

		await page.waitForTimeout(1_000);
	}

	throw new Error(
		`Jarvis 빌드/배포 성공 상태를 확인하지 못했습니다. 첫 번째 ${JARVIS_STATUS_ICON_SELECTOR} 부모 class: ${lastClassName || "(없음)"}${lastErrorMessage ? ` / ${lastErrorMessage}` : ""}`
	);
}

export function hasJarvisSuccessClass(className) {
	return String(className)
		.split(/\s+/)
		.includes(JARVIS_SUCCESS_CLASS);
}

export function hasJarvisDeploySuccessClass(className) {
	return hasJarvisSuccessClass(className);
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
