/** Ship upstream release bytes because the plugin host accepts relative imports. */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const acquired = nodePath.join(root, "node_modules/unbash");
const shipped = nodePath.join(root, "vendor/unbash");
const mode = process.argv[2];
if (mode !== "sync" && mode !== "check") {
  throw new Error("Use vendor-unbash.ts sync|check");
}
const packageInfo = JSON.parse(
  await readFile(nodePath.join(acquired, "package.json"), "utf8"),
) as { version: string };
const project = JSON.parse(
  await readFile(nodePath.join(root, "package.json"), "utf8"),
) as { devDependencies: { unbash: string } };
const lock = JSON.parse(
  await readFile(nodePath.join(root, "package-lock.json"), "utf8"),
) as {
  packages: Record<
    string,
    { version: string; integrity: string; resolved: string }
  >;
};
const locked = lock.packages["node_modules/unbash"];
if (
  packageInfo.version !== project.devDependencies.unbash ||
  locked?.version !== packageInfo.version
) {
  throw new Error(
    "unbash acquisition must match its exact manifest and lock pin",
  );
}

const closure = async (
  name: string,
  visited: readonly string[] = [],
): Promise<readonly string[]> => {
  if (visited.includes(name)) {
    return visited;
  }
  const source = await readFile(nodePath.join(acquired, name), "utf8");
  const imports = ts
    .createSourceFile(name, source, ts.ScriptTarget.Latest)
    .statements.filter((statement) => ts.isImportDeclaration(statement))
    .flatMap((statement) =>
      ts.isStringLiteral(statement.moduleSpecifier)
        ? [
            nodePath.join(
              nodePath.dirname(name),
              statement.moduleSpecifier.text,
            ),
          ]
        : [],
    );
  return importedClosure(imports, [...visited, name]);
};
const importedClosure = async (
  imports: readonly string[],
  visited: readonly string[],
): Promise<readonly string[]> => {
  const [dependency, ...rest] = imports;
  return dependency === undefined
    ? visited
    : importedClosure(rest, await closure(dependency, visited));
};
const modules = await closure("dist/parser.js");
const acquiredFiles = await readdir(nodePath.join(acquired, "dist"));
const declarations = acquiredFiles
  .filter((name) => name.endsWith(".d.ts"))
  .map((name) => `dist/${name}`);
const paths = ["LICENSE", ...modules, ...declarations].toSorted((left, right) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right)),
);
const contents = await Promise.all(
  paths.map(async (path) => ({
    path,
    bytes: await readFile(nodePath.join(acquired, path)),
  })),
);
const provenance = Buffer.from(
  `${JSON.stringify(
    {
      name: "unbash",
      version: packageInfo.version,
      license: "ISC",
      source: locked.resolved,
      integrity: locked.integrity,
      entry: "dist/parser.js",
      runtimeBytes: contents
        .filter(({ path }) => modules.includes(path))
        .reduce((total, { bytes }) => total + bytes.length, 0),
      files: contents.map(({ path, bytes }) => ({
        path,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })),
    },
    null,
    2,
  )}\n`,
);
const expected = [...contents, { path: "provenance.json", bytes: provenance }];
if (mode === "sync") {
  await rm(shipped, { recursive: true, force: true });
  await Promise.all(
    expected.map(async ({ path, bytes }) => {
      const target = nodePath.join(shipped, path);
      await mkdir(nodePath.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }),
  );
} else {
  const shippedFiles = await readdir(shipped, {
    recursive: true,
    withFileTypes: true,
  });
  const actual = shippedFiles
    .filter((entry) => entry.isFile())
    .map((entry) => nodePath.resolve(entry.parentPath, entry.name));
  if (actual.length !== expected.length) {
    throw new Error(
      "unbash vendor contains missing or extra files; run vendor:sync",
    );
  }
  await Promise.all(
    expected.map(async ({ path, bytes }) => {
      const actualBytes = await readFile(nodePath.join(shipped, path));
      if (!actualBytes.equals(bytes)) {
        throw new Error(
          `unbash vendor differs from acquired release: ${path}; run vendor:sync`,
        );
      }
    }),
  );
}
