import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(root, ".github/scripts/night-merge.sh");

// The merge of a night-fix PR runs as github-actions[bot], and a bot merge
// gets neither the Fixes-cascade nor head-branch deletion. night-merge.sh is
// the explicit aftermath: close the linked issues, delete the branch. A fake
// `gh` on PATH records every call; `issue view` answers $STUB_STATE and the
// branch delete exits with $STUB_DELETE_RC, so a GitHub-side deletion that
// raced us can be simulated.
const GH_STUB = `#!/bin/sh
echo "$*" >> "$GH_LOG"
case "$1" in
  api) exit "\${STUB_DELETE_RC:-0}" ;;
  issue) [ "$2" = view ] && echo "\${STUB_STATE:-OPEN}" ;;
esac
exit 0
`;

interface Rig {
  env: NodeJS.ProcessEnv;
  calls: () => string[];
}

function rig(t: test.TestContext): Rig {
  const dir = mkdtempSync(join("/tmp", "night-merge-"));
  t.after(() => spawnSync("rm", ["-rf", dir]));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), GH_STUB);
  chmodSync(join(bin, "gh"), 0o755);
  const log = join(dir, "gh.log");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    GH_LOG: log,
    REPO: "octo/repo",
  };
  return {
    env,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8").split("\n").filter(Boolean)
        : [],
  };
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync("sh", [SCRIPT], { env, encoding: "utf8" });
}

const MERGED = {
  PR_MERGED: "true",
  PR_NUMBER: "80",
  PR_HEAD_REF: "night-fix/9ccf47e22f2f",
  PR_MERGE_SHA: "deadbee",
  PR_BODY: "The fix makes the reproduction pass.\n\nFixes #63\n",
};

test("a merged night-fix PR closes its linked issue and deletes the branch", (t) => {
  const { env, calls } = rig(t);
  const res = run({ ...env, ...MERGED });
  assert.equal(res.status, 0, `night-merge.sh failed: ${res.stderr}`);

  const close = calls().filter((c) => c.startsWith("issue close"));
  assert.equal(close.length, 1, `expected one issue close: ${calls()}`);
  assert.match(close[0], /^issue close 63 -R octo\/repo --comment /);
  assert.match(close[0], /#80/);
  assert.match(close[0], /deadbee/);

  const del = calls().filter((c) => c.startsWith("api -X DELETE"));
  assert.deepEqual(del, [
    "api -X DELETE repos/octo/repo/git/refs/heads/night-fix/9ccf47e22f2f --silent",
  ]);
});

test("an issue a human merge already closed is noted, never re-closed", (t) => {
  const { env, calls } = rig(t);
  const res = run({ ...env, ...MERGED, STUB_STATE: "CLOSED" });
  assert.equal(res.status, 0, `night-merge.sh failed: ${res.stderr}`);
  assert.equal(
    calls().filter((c) => c.startsWith("issue close")).length,
    0,
    `no issue close expected: ${calls()}`,
  );
  assert.equal(
    calls().filter((c) => c.startsWith("api -X DELETE")).length,
    1,
    `the branch delete must still run: ${calls()}`,
  );
});

test("a branch deletion that raced with GitHub is a warning, not a failure", (t) => {
  const { env, calls } = rig(t);
  const res = run({ ...env, ...MERGED, STUB_DELETE_RC: "1" });
  assert.equal(res.status, 0, `night-merge.sh failed: ${res.stderr}`);
  assert.match(res.stderr + res.stdout, /::warning::.*9ccf47e22f2f/);
  assert.equal(
    calls().filter((c) => c.startsWith("issue close")).length,
    1,
    `the issue close must run regardless: ${calls()}`,
  );
});

test("an unmerged close or a foreign branch changes nothing", (t) => {
  const { env, calls } = rig(t);
  for (const pr of [
    { ...MERGED, PR_MERGED: "false" },
    { ...MERGED, PR_HEAD_REF: "feat/ordinary" },
  ]) {
    const res = run({ ...env, ...pr });
    assert.equal(res.status, 0, `night-merge.sh failed: ${res.stderr}`);
  }
  assert.deepEqual(calls(), []);
});

test("every closing keyword of the body is honoured", (t) => {
  const { env, calls } = rig(t);
  const res = run({
    ...env,
    ...MERGED,
    PR_BODY:
      "fixes #63\nCloses #64\nresolved #65\nmentions #66 without a keyword\n",
  });
  assert.equal(res.status, 0, `night-merge.sh failed: ${res.stderr}`);
  const closed = calls()
    .filter((c) => c.startsWith("issue close"))
    .map((c) => c.split(" ")[2])
    .sort();
  assert.deepEqual(closed, ["63", "64", "65"]);
});

test("a merged PR without issue links only deletes the branch", (t) => {
  const { env, calls } = rig(t);
  const res = run({ ...env, ...MERGED, PR_BODY: "no linked issue\n" });
  assert.equal(res.status, 0, `night-merge.sh failed: ${res.stderr}`);
  assert.deepEqual(calls(), [
    "api -X DELETE repos/octo/repo/git/refs/heads/night-fix/9ccf47e22f2f --silent",
  ]);
});
