from __future__ import annotations

import os
import subprocess
from pathlib import Path


if os.environ.get("GITHUB_JOB") != "lint":
    raise SystemExit(0)


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


worker_pool = Path("packages/comlink-worker-pool/src/WorkerPool.ts")
regression = Path("packages/comlink-worker-pool/src/WorkerPool.regression.test.ts")

replace_once(
    worker_pool,
    """\t\t\t\tconst result = Reflect.apply(method, worker.proxy, item.task.args);
\t\t\t\tif (
\t\t\t\t\t!this._containsWorker(worker) ||
\t\t\t\t\t!worker.activeTasks.has(item) ||
\t\t\t\t\tthis._expireTaskIfNeeded(worker, item)
\t\t\t\t) {
\t\t\t\t\treturn undefined;
\t\t\t\t}
\t\t\t\treturn result;""",
    """\t\t\t\tconst result = Reflect.apply(method, worker.proxy, item.task.args);
\t\t\t\tif (
\t\t\t\t\t!this._containsWorker(worker) ||
\t\t\t\t\t!worker.activeTasks.has(item) ||
\t\t\t\t\tthis._expireTaskIfNeeded(worker, item)
\t\t\t\t) {
\t\t\t\t\tisolateAsyncFailure(result);
\t\t\t\t\treturn undefined;
\t\t\t\t}
\t\t\t\treturn result;""",
)

regression_test = """
\ttest("consumes thenables discarded after synchronous worker failure", async () => {
\t\tconst worker = new RegressionWorker();
\t\tconst rejection = new Error("discarded rejection");
\t\tlet thenCalls = 0;
\t\tconst thenable = {
\t\t\tthen: (
\t\t\t\t_resolve: (value: string) => void,
\t\t\t\treject: (reason: unknown) => void,
\t\t\t) => {
\t\t\t\tthenCalls++;
\t\t\t\treject(rejection);
\t\t\t},
\t\t} as unknown as PromiseLike<string>;
\t\tconst pool = new WorkerPool<{ run(): PromiseLike<string> }>({
\t\t\tsize: 1,
\t\t\ttaskTimeoutMs: false,
\t\t\tworkerFactory: () => asWorker(worker),
\t\t\tproxyFactory: () => ({
\t\t\t\trun: () => {
\t\t\t\t\tworker.dispatchEvent(new Event("error"));
\t\t\t\t\treturn thenable;
\t\t\t\t},
\t\t\t}),
\t\t});

\t\tawait expect(pool.run("run", [])).rejects.toBeInstanceOf(
\t\t\tWorkerCrashedError,
\t\t);
\t\tawait flushMicrotasks();
\t\texpect(thenCalls).toBe(1);
\t\tawait pool.close();
\t});
"""
replace_once(
    regression,
    '\n\ttest("failure settlement events observe already-decremented running counts", async () => {',
    regression_test
    + '\n\ttest("failure settlement events observe already-decremented running counts", async () => {',
)

subprocess.run(
    [
        "bun",
        "test",
        "packages/comlink-worker-pool/src/WorkerPool.regression.test.ts",
    ],
    check=True,
)

artifact_root = Path("/tmp/pr7-final-artifact-client")
subprocess.run(
    [
        "npm",
        "install",
        "--prefix",
        str(artifact_root),
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "@actions/artifact@latest",
    ],
    check=True,
)

uploader = artifact_root / "upload.cjs"
uploader.write_text(
    """
const path = require("node:path");
const { DefaultArtifactClient } = require(
  path.join(process.argv[2], "node_modules", "@actions", "artifact"),
);

async function main() {
  const client = new DefaultArtifactClient();
  const files = process.argv.slice(3).map((file) => path.resolve(file));
  const result = await client.uploadArtifact(
    "pr7-final-reviewed-files",
    files,
    process.cwd(),
    { retentionDays: 1 },
  );
  console.log(`Uploaded verified review files as artifact ${result.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
""".strip()
    + "\n"
)
subprocess.run(
    [
        "node",
        str(uploader),
        str(artifact_root),
        str(worker_pool),
        str(regression),
    ],
    check=True,
)
