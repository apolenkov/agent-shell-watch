import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// A gh that answers only what autofix-report.sh needs for the PR loop. The one
// Dependabot PR was opened long before the window but is MERGED now, so a report
// of "what Dependabot PRs did in the last N days" must count it.
const GH_STUB = `#!/usr/bin/env bash
case "$*" in
  "pr list"*"app/dependabot"*) cat "$GH_FIXTURE_DIR/prs.json" ;;
  "pr list"*) printf '[]' ;;
  "pr view"*) : ;;
  *"contents/.github/workflows/ci-autofix.yml"*) base64 < "$GH_FIXTURE_DIR/workflow.yml" ;;
  *"actions/workflows/ci-autofix.yml/runs"*) printf '{"workflow_runs":[]}' ;;
  *) : ;;
esac
`;

const WORKFLOW = "env:\n  PROTECTED: |\n    tests/**\n";

test("a Dependabot PR created before the window but merged inside is counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "autofix-repro-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(dir, "prs.json"),
    JSON.stringify([
      {
        number: 7,
        title: "Bump left-pad",
        state: "MERGED",
        createdAt: "2000-01-01T00:00:00Z",
        mergedAt: "2099-01-01T00:00:00Z",
        updatedAt: "2099-01-01T00:00:00Z",
        author: { login: "app/dependabot" },
        labels: [],
        body: "",
      },
    ]),
  );
  writeFileSync(join(dir, "workflow.yml"), WORKFLOW);
  const gh = join(bin, "gh");
  writeFileSync(gh, GH_STUB);
  chmodSync(gh, 0o755);

  const res = spawnSync(
    "bash",
    ["scripts/autofix-report.sh", "test/repo", "14"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GH_FIXTURE_DIR: dir,
      },
    },
  );

  assert.equal(res.status, 0, `autofix-report.sh failed: ${res.stderr}`);
  assert.match(
    res.stdout,
    /dependabot PRs: merged clean=1/,
    `the pre-window PR merged inside the window was dropped:\n${res.stdout}`,
  );
});
