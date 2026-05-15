import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR = path.resolve(path.dirname(__filename), "..");
export const PUBLIC_DIR = path.join(ROOT_DIR, "public");
export const DATA_DIR = process.env.LASSO_DATA_DIR ? path.resolve(process.env.LASSO_DATA_DIR) : path.join(ROOT_DIR, "data");
export const SCREENSHOT_DIR = path.join(DATA_DIR, "screenshots");
export const BROWSER_PROFILE_DIR = path.join(DATA_DIR, "browser-profile");
export const STATE_FILE = path.join(DATA_DIR, "state.json");
export const PORT = Number(process.env.PORT || 7355);

export const PROJECTS = {
  event: {
    label: "이벤트",
    bitbucket: {
      label: "OB Backend",
      url:
        "https://code.skplanet.com/projects/OB/repos/ob-backend/pull-requests?create&activeTab=compare-commits-tab&targetRepoId=7432&targetBranch=refs%2Fheads%2Fdevelop"
    },
    jarvis: {
      was: {
        label: "WAS",
        projectId: "7350",
        deployConfigId: "9601",
        deployLabel: "WAS1",
        url: "https://devjarvis.skplanet.com/#/home/projects/7350/deployConfig/9601"
      },
      web: {
        label: "WEB",
        projectId: "7286",
        deployConfigId: "9519",
        deployLabel: "배포",
        url: "https://devjarvis.skplanet.com/#/home/projects/7286/deployConfig/9519"
      }
    }
  },
  promotion: {
    label: "프로모션",
    bitbucket: {
      label: "OB Promotion",
      url:
        "https://code.skplanet.com/projects/OEP/repos/ob-promotion/pull-requests?create&activeTab=compare-commits-tab&targetRepoId=8621&targetBranch=refs%2Fheads%2Fdevelop"
    },
    jarvis: {
      was: {
        label: "WAS",
        projectId: "6756",
        deployConfigId: "8940",
        deployLabel: "배포 설정",
        url: "https://devjarvis.skplanet.com/#/home/projects/6756/deployConfig/8940"
      },
      web: {
        label: "WEB",
        projectId: "7257",
        deployConfigId: "9484",
        deployLabel: "배포 설정",
        url: "https://devjarvis.skplanet.com/#/home/projects/7257/deployConfig/9484"
      }
    }
  }
};

export const DEFAULT_SELECTION = {
  projectKey: "event",
  branchName: "",
  mergePr: true,
  targets: ["was"],
  mode: "buildOnly"
};

export function detectBrowserExecutablePath() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.LocalAppData || "", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env.LocalAppData || "", "Microsoft\\Edge\\Application\\msedge.exe")
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

export function publicProjectConfig() {
  return Object.fromEntries(
    Object.entries(PROJECTS).map(([key, project]) => [
      key,
      {
        label: project.label,
        bitbucketLabel: project.bitbucket.label,
        jarvis: Object.fromEntries(
          Object.entries(project.jarvis).map(([targetKey, target]) => [
            targetKey,
            {
              label: target.label,
              projectId: target.projectId,
              deployConfigId: target.deployConfigId,
              deployLabel: target.deployLabel
            }
          ])
        )
      }
    ])
  );
}
