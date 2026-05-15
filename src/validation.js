import { PROJECTS } from "./config.js";

const TARGET_ORDER = ["was", "web"];
const VALID_MODES = new Set(["buildOnly", "buildAndDeploy"]);

export function validateRunRequest(input) {
  const errors = [];
  const body = input && typeof input === "object" ? input : {};
  const projectKey = typeof body.projectKey === "string" ? body.projectKey : "";
  const branchName = typeof body.branchName === "string" ? body.branchName.trim() : "";
  const mergePr = Boolean(body.mergePr);
  const mode = typeof body.mode === "string" ? body.mode : "";
  const browserExecutablePath =
    typeof body.browserExecutablePath === "string" ? body.browserExecutablePath.trim() : "";

  if (!Object.hasOwn(PROJECTS, projectKey)) {
    errors.push("프로젝트를 선택하세요.");
  }

  if (!branchName) {
    errors.push("브랜치명을 입력하세요.");
  }

  if (mergePr && isDevelopBranch(branchName)) {
    errors.push("PR 처리 시 source 브랜치는 develop이 아니어야 합니다.");
  }

  const rawTargets = Array.isArray(body.targets) ? body.targets : [];
  const uniqueTargets = [...new Set(rawTargets)].filter((target) => TARGET_ORDER.includes(target));
  const targets = TARGET_ORDER.filter((target) => uniqueTargets.includes(target));
  if (targets.length === 0) {
    errors.push("WAS 또는 WEB 대상 중 하나 이상을 선택하세요.");
  }

  if (!VALID_MODES.has(mode)) {
    errors.push("실행 모드를 선택하세요.");
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      projectKey,
      branchName,
      mergePr,
      targets,
      mode,
      browserExecutablePath
    }
  };
}

function isDevelopBranch(branchName) {
  const normalized = branchName.trim().toLowerCase().replace(/^refs\/heads\//, "");
  return normalized === "develop";
}
