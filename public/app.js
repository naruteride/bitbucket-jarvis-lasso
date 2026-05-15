const state = {
	config: null,
	activeRunId: null,
	eventSource: null
};

const form = document.querySelector("#runForm");
const projectOptions = document.querySelector("#projectOptions");
const branchNameInput = document.querySelector("#branchName");
const recentBranches = document.querySelector("#recentBranches");
const mergePrInput = document.querySelector("#mergePr");
const stepDelayInput = document.querySelector("#stepDelaySeconds");
const browserPathInput = document.querySelector("#browserExecutablePath");
const summary = document.querySelector("#summary");
const runButton = document.querySelector("#runButton");
const cancelButton = document.querySelector("#cancelButton");
const clearLogButton = document.querySelector("#clearLogButton");
const logList = document.querySelector("#logList");
const statusBadge = document.querySelector("#statusBadge");
const wasHint = document.querySelector("#wasHint");
const webHint = document.querySelector("#webHint");

init().catch((error) => {
	appendLog({ level: "error", message: error.message, time: new Date().toISOString() });
});

async function init() {
	state.config = await fetchJson("/api/config");
	renderProjects();
	renderRecentBranches();
	applyLastSelection();
	updateTargetHints();
	updateSummary();

	if (state.config.activeRunId) {
		attachRun(state.config.activeRunId);
	}

	form.addEventListener("input", () => {
		updateTargetHints();
		updateSummary();
	});

	form.addEventListener("submit", onSubmit);
	cancelButton.addEventListener("click", onCancel);
	clearLogButton.addEventListener("click", () => {
		logList.replaceChildren();
	});
}

function renderProjects() {
	projectOptions.replaceChildren(
		...Object.entries(state.config.projects).map(([key, project]) => {
			const label = document.createElement("label");
			const input = document.createElement("input");
			input.type = "radio";
			input.name = "projectKey";
			input.value = key;
			input.checked = key === "event";
			const span = document.createElement("span");
			span.textContent = project.label;
			label.append(input, span);
			return label;
		})
	);
}

function renderRecentBranches() {
	recentBranches.replaceChildren(
		...state.config.recentBranches.map((branch) => {
			const option = document.createElement("option");
			option.value = branch;
			return option;
		})
	);
}

function applyLastSelection() {
	const selection = state.config.lastSelection || {};
	setRadio("projectKey", selection.projectKey || "event");
	branchNameInput.value = selection.branchName || "";
	mergePrInput.checked = selection.mergePr !== false;
	setRadio("mode", selection.mode || "buildOnly");

	const targets = new Set(selection.targets && selection.targets.length ? selection.targets : ["was"]);
	for (const input of form.querySelectorAll('input[name="targets"]')) {
		input.checked = targets.has(input.value);
	}

	browserPathInput.value = state.config.browserExecutablePath || "";
	stepDelayInput.value = selection.stepDelaySeconds ?? 1;
}

async function onSubmit(event) {
	event.preventDefault();
	const payload = readPayload();
	const validationErrors = validatePayload(payload);
	if (validationErrors.length) {
		alert(validationErrors.join("\n"));
		return;
	}

	const text = buildSummary(payload);
	if (!confirm(`${text}\n\n이 설정으로 실행할까요?`)) {
		return;
	}

	setRunning(true);
	appendLog({ level: "info", message: "실행 요청을 보냅니다.", time: new Date().toISOString(), details: payload });

	try {
		const result = await fetchJson("/api/run", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		attachRun(result.runId);
	} catch (error) {
		appendLog({ level: "error", message: error.message, time: new Date().toISOString() });
		setRunning(false, "failed");
	}
}

async function onCancel() {
	if (!state.activeRunId) {
		return;
	}
	cancelButton.disabled = true;
	await fetchJson(`/api/runs/${encodeURIComponent(state.activeRunId)}/cancel`, { method: "POST" }).catch((error) => {
		appendLog({ level: "error", message: error.message, time: new Date().toISOString() });
	});
}

function attachRun(runId) {
	state.activeRunId = runId;
	setRunning(true);
	if (state.eventSource) {
		state.eventSource.close();
	}

	state.eventSource = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
	state.eventSource.onmessage = (event) => appendLog(JSON.parse(event.data));

	for (const type of ["info", "warn", "success", "error", "done"]) {
		state.eventSource.addEventListener(type, (event) => {
			const payload = JSON.parse(event.data);
			appendLog(payload);
			if (type === "done") {
				state.eventSource.close();
				const finalStatus = payload.details && payload.details.status;
				setRunning(false, finalStatus === "success" ? "success" : "failed");
			}
		});
	}

	state.eventSource.onerror = () => {
		appendLog({ level: "warn", message: "로그 연결이 끊어졌습니다.", time: new Date().toISOString() });
	};
}

function readPayload() {
	return {
		projectKey: getRadio("projectKey"),
		branchName: branchNameInput.value.trim(),
		mergePr: mergePrInput.checked,
		targets: [...form.querySelectorAll('input[name="targets"]:checked')].map((input) => input.value),
		mode: getRadio("mode"),
		stepDelaySeconds: Number(stepDelayInput.value || 1),
		browserExecutablePath: browserPathInput.value.trim()
	};
}

function validatePayload(payload) {
	const errors = [];
	if (!payload.branchName) {
		errors.push("브랜치명을 입력하세요.");
	}
	if (payload.mergePr && payload.branchName.replace(/^refs\/heads\//i, "").toLowerCase() === "develop") {
		errors.push("PR 처리 시 source 브랜치는 develop이 아니어야 합니다.");
	}
	if (!payload.targets.length) {
		errors.push("WAS 또는 WEB 대상 중 하나 이상을 선택하세요.");
	}
	if (!Number.isFinite(payload.stepDelaySeconds) || payload.stepDelaySeconds < 0 || payload.stepDelaySeconds > 30) {
		errors.push("각 단계 대기시간은 0초 이상 30초 이하로 입력하세요.");
	}
	return errors;
}

function updateTargetHints() {
	const project = state.config.projects[getRadio("projectKey")];
	wasHint.textContent = describeTarget(project.jarvis.was);
	webHint.textContent = describeTarget(project.jarvis.web);
}

function updateSummary() {
	summary.textContent = buildSummary(readPayload());
}

function buildSummary(payload) {
	const project = state.config.projects[payload.projectKey];
	const targetNames = orderedTargets(payload.targets).map((target) => project.jarvis[target].label).join(", ") || "선택 없음";
	const mode = payload.mode === "buildAndDeploy" ? "빌드 후 배포" : "빌드만";
	const pr = payload.mergePr ? "PR 생성/머지 진행" : "PR 생략";
	return [
		`프로젝트: ${project.label}`,
		`브랜치: ${payload.branchName || "-"}`,
		`처리: ${pr}`,
		`대상: ${targetNames}`,
		`모드: ${mode}`,
		`단계 대기: ${payload.stepDelaySeconds || 0}초`
	].join("\n");
}

function orderedTargets(targets) {
	const selected = new Set(targets);
	return ["web", "was"].filter((target) => selected.has(target));
}

function describeTarget(target) {
	return `project ${target.projectId} / config ${target.deployConfigId} / ${target.deployLabel}`;
}

function setRunning(isRunning, finalStatus = "idle") {
	runButton.disabled = isRunning;
	cancelButton.disabled = !isRunning;
	statusBadge.className = `badge ${isRunning ? "running" : finalStatus}`;
	statusBadge.textContent = isRunning ? "실행 중" : finalStatus === "success" ? "완료" : finalStatus === "failed" ? "실패" : "대기 중";
}

function appendLog(event) {
	const item = document.createElement("li");
	item.className = event.level || "info";

	const meta = document.createElement("div");
	meta.className = "meta";
	const time = document.createElement("span");
	time.textContent = event.time ? new Date(event.time).toLocaleTimeString() : "";
	const level = document.createElement("span");
	level.textContent = event.level || "info";
	meta.append(time, level);

	const message = document.createElement("div");
	message.className = "message";
	message.textContent = event.message;
	item.append(meta, message);

	if (event.details && Object.keys(event.details).length) {
		const details = document.createElement("pre");
		details.textContent = JSON.stringify(event.details, null, 2);
		item.append(details);
	}

	logList.append(item);
	item.scrollIntoView({ block: "end" });
}

async function fetchJson(url, options) {
	const response = await fetch(url, options);
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || (payload.errors && payload.errors.join("\n")) || `HTTP ${response.status}`);
	}
	return payload;
}

function getRadio(name) {
	return form.querySelector(`input[name="${name}"]:checked`).value;
}

function setRadio(name, value) {
	const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
	if (input) {
		input.checked = true;
	}
}
