import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// update-types.sh picks the newest /tmp/claude-*/.../claude-code.d.ts and copies
// it into engine-types/ — /tmp is shared, so only a regular file that really
// sits in the engine's tree is acceptable input, never a symlink or a
// directory, and the chosen source must be printed.
const TYPES_REL =
  "bundled-skills/sk/sub/plugin-authoring/types/claude-code.d.ts";

function fakeRepo(t: test.TestContext): string {
  const dir = mkdtempSync(join("/tmp", "update-types-repo-"));
  t.after(() => spawnSync("rm", ["-rf", dir]));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "engine-types"));
  cpSync(
    join(root, "scripts/update-types.sh"),
    join(dir, "scripts/update-types.sh"),
  );
  chmodSync(join(dir, "scripts/update-types.sh"), 0o755);
  return dir;
}

function engineTypesDir(t: test.TestContext, tag: string): string {
  const dir = mkdtempSync(join("/tmp", `claude-fake-${tag}-`));
  t.after(() => spawnSync("rm", ["-rf", dir]));
  const types = join(dir, dirname(TYPES_REL));
  mkdirSync(types, { recursive: true });
  return types;
}

function run(dir: string) {
  return spawnSync("sh", ["scripts/update-types.sh"], {
    cwd: dir,
    encoding: "utf8",
  });
}

test("newer symlinks are skipped; the regular file is copied and named", (t) => {
  const repo = fakeRepo(t);
  const good = join(engineTypesDir(t, "good"), "claude-code.d.ts");
  writeFileSync(good, "// real engine declarations\n");
  // Newer candidates, created after the real file so ls -t lists them first:
  // a link resolving outside the engine tree, and a link resolving inside it —
  // the second one only the ! -L check can reject.
  symlinkSync("/etc/hosts", join(engineTypesDir(t, "bad"), "claude-code.d.ts"));
  symlinkSync(good, join(engineTypesDir(t, "alsolink"), "claude-code.d.ts"));

  const res = run(repo);
  assert.equal(res.status, 0, `update-types.sh failed: ${res.stderr}`);
  assert.match(
    res.stdout,
    /copied .*claude-fake-good-.*claude-code\.d\.ts -> engine-types\/claude-code\.d\.ts/,
  );
  assert.equal(
    readFileSync(join(repo, "engine-types/claude-code.d.ts"), "utf8"),
    "// real engine declarations\n",
  );
});

test("a symlink or directory candidate is never the copied source", (t) => {
  const repo = fakeRepo(t);
  const typesDir = engineTypesDir(t, "onlybad");
  symlinkSync("/etc/hosts", join(typesDir, "claude-code.d.ts"));
  mkdirSync(join(engineTypesDir(t, "dircand"), "claude-code.d.ts"));
  // The machine may hold real engine files older than these; whatever the
  // outcome, the bad candidates must never win.
  const res = run(repo);
  const dst = join(repo, "engine-types/claude-code.d.ts");
  const hosts = readFileSync("/etc/hosts", "utf8");
  if (res.status === 0) {
    const src = res.stdout.match(/copied (\S+) ->/)?.[1] ?? "";
    assert.ok(src, `the copied source is not printed: ${res.stdout}`);
    assert.notEqual(readFileSync(dst, "utf8"), hosts);
    assert.notEqual(readFileSync(src, "utf8"), hosts);
    assert.equal(
      spawnSync("test", ["-f", src]).status,
      0,
      `${src} is not a regular file`,
    );
    assert.equal(
      spawnSync("test", ["-L", src]).status,
      1,
      `${src} is a symlink`,
    );
  } else {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no declarations found/);
    assert.equal(existsSync(dst), false);
  }
});

test("an uncommitted destination is overwritten only with a warning", (t) => {
  const repo = fakeRepo(t);
  writeFileSync(join(repo, "engine-types/claude-code.d.ts"), "// old\n");
  for (const args of [
    ["init", "-q"],
    ["add", "engine-types/claude-code.d.ts"],
  ]) {
    assert.equal(spawnSync("git", args, { cwd: repo }).status, 0);
  }
  writeFileSync(
    join(repo, "engine-types/claude-code.d.ts"),
    "// local edits\n",
  );
  const good = join(engineTypesDir(t, "dirty"), "claude-code.d.ts");
  writeFileSync(good, "// real engine declarations\n");

  const res = run(repo);
  assert.equal(res.status, 0, `update-types.sh failed: ${res.stderr}`);
  assert.match(
    res.stderr,
    /warning: engine-types\/claude-code\.d\.ts has uncommitted changes/,
  );
  assert.equal(
    readFileSync(join(repo, "engine-types/claude-code.d.ts"), "utf8"),
    "// real engine declarations\n",
  );
});
