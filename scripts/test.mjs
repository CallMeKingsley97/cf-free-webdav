import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = await mkdtemp(path.join(tmpdir(), "cf-free-webdav-test-"));
const tsc = path.join(projectRoot, "node_modules", ".bin", "tsc");

try {
  await writeFile(path.join(buildRoot, "package.json"), JSON.stringify({ type: "module" }));
  const compile = spawnSync(tsc, [
    "--noEmit", "false", "--declaration", "false", "--sourceMap", "false", "--incremental", "false",
    "--pretty", "false", "--outDir", buildRoot,
  ], { cwd: projectRoot, encoding: "utf8" });
  if (compile.stdout) process.stdout.write(compile.stdout);
  if (compile.stderr) process.stderr.write(compile.stderr);
  if (compile.status !== 0) process.exitCode = compile.status || 1;
  else {
    const testRoot = path.join(projectRoot, "test");
    const files = (await readdir(testRoot)).filter((name) => name.endsWith(".test.mjs")).map((name) => path.join(testRoot, name));
    const run = spawnSync(process.execPath, ["--test", ...files], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CF_TEST_BUILD_DIR: buildRoot },
    });
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    process.exitCode = run.status === 0 ? 0 : run.status ?? 1;
  }
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}
