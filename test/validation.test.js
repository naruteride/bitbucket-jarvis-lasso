import test from "node:test";
import assert from "node:assert/strict";
import { validateRunRequest } from "../src/validation.js";

test("accepts a valid build-only request", () => {
  const result = validateRunRequest({
    projectKey: "event",
    branchName: "feature/event-123",
    mergePr: true,
    targets: ["web", "was"],
    mode: "buildOnly"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.targets, ["web", "was"]);
  assert.equal(result.value.stepDelaySeconds, 1);
});

test("rejects missing branch", () => {
  const result = validateRunRequest({
    projectKey: "event",
    branchName: "",
    mergePr: false,
    targets: ["was"],
    mode: "buildOnly"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /브랜치/);
});

test("rejects develop source branch when PR merge is enabled", () => {
  const result = validateRunRequest({
    projectKey: "promotion",
    branchName: "refs/heads/develop",
    mergePr: true,
    targets: ["web"],
    mode: "buildAndDeploy"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /develop/);
});

test("rejects empty target selection", () => {
  const result = validateRunRequest({
    projectKey: "promotion",
    branchName: "feature/promo-9",
    mergePr: false,
    targets: [],
    mode: "buildOnly"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /WAS 또는 WEB/);
});

test("normalizes configured step delay", () => {
  const result = validateRunRequest({
    projectKey: "event",
    branchName: "feature/event-123",
    mergePr: false,
    targets: ["was"],
    mode: "buildOnly",
    stepDelaySeconds: "4.5"
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.stepDelaySeconds, 4.5);
});
