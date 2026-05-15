import test from "node:test";
import assert from "node:assert/strict";
import {
  BITBUCKET_MERGE_CONFIRM_SELECTOR,
  JARVIS_STATUS_ICON_SELECTOR,
  JARVIS_SUCCESS_CLASS,
  hasJarvisSuccessClass,
  buildBitbucketPullRequestUrl
} from "../src/automation.js";

test("adds sourceBranch query parameter for a feature branch", () => {
  const url = buildBitbucketPullRequestUrl(
    "https://code.skplanet.com/projects/OEP/repos/ob-promotion/pull-requests?create&activeTab=compare-commits-tab&targetRepoId=8621&targetBranch=refs%2Fheads%2Fdevelop",
    "feature/OCBSVR-16071"
  );

  assert.equal(
    url,
    "https://code.skplanet.com/projects/OEP/repos/ob-promotion/pull-requests?create&activeTab=compare-commits-tab&sourceBranch=refs%2Fheads%2Ffeature%2FOCBSVR-16071&targetRepoId=8621&targetBranch=refs%2Fheads%2Fdevelop"
  );
});

test("does not duplicate refs/heads prefix", () => {
  const url = buildBitbucketPullRequestUrl(
    "https://code.skplanet.com/projects/OB/repos/ob-backend/pull-requests?create&activeTab=compare-commits-tab&targetRepoId=7432&targetBranch=refs%2Fheads%2Fdevelop",
    "refs/heads/feature/OCBSVR-16071"
  );

  assert.match(url, /sourceBranch=refs%2Fheads%2Ffeature%2FOCBSVR-16071/);
  assert.doesNotMatch(url, /refs%2Fheads%2Frefs%2Fheads/);
});

test("uses Bitbucket dialog action button for merge confirmation", () => {
  assert.equal(BITBUCKET_MERGE_CONFIRM_SELECTOR, '[role="dialog"] button.action-button');
});

test("detects Jarvis build/deploy success class exactly", () => {
  assert.equal(JARVIS_STATUS_ICON_SELECTOR, "i.fas.fa-circle");
  assert.equal(JARVIS_SUCCESS_CLASS, "deploy-status-0");
  assert.equal(hasJarvisSuccessClass("deploy-status-1 deploy-status-0"), true);
  assert.equal(hasJarvisSuccessClass("deploy-status-01"), false);
});
