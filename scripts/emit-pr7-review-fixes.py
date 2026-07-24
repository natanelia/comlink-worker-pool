from __future__ import annotations

import subprocess
import tarfile
from pathlib import Path

workflow = Path(".github/workflows/apply-pr7-review-fixes.yml")
lines = workflow.read_text().splitlines()
start_marker = "          python3 <<'PY'"
end_marker = "          PY"
start = lines.index(start_marker) + 1
end = lines.index(end_marker, start)
code = "\n".join(
    line[10:] if line.startswith("          ") else line
    for line in lines[start:end]
)
exec(compile(code, str(workflow), "exec"), {})

paths = [
    Path("packages/comlink-worker-pool/src/WorkerPool.ts"),
    Path("packages/comlink-worker-pool/src/internal/scheduler.ts"),
    Path("packages/comlink-worker-pool/src/WorkerPool.regression.test.ts"),
]
archive_path = Path("pr7-reviewed-fixes.tar.gz")
with tarfile.open(archive_path, mode="w:gz") as archive:
    for path in paths:
        archive.add(path, arcname=str(path))

artifact_root = Path("/tmp/pr7-artifact-client")
subprocess.run(
    [
        "npm",
        "install",
        "--prefix",
        str(artifact_root),
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "@actions/artifact@6.2.1",
    ],
    check=True,
)
uploader = artifact_root / "upload.cjs"
uploader.write_text(
    """
const { DefaultArtifactClient } = require("./node_modules/@actions/artifact");

async function main() {
  const client = new DefaultArtifactClient();
  const result = await client.uploadArtifact(
    "pr7-reviewed-fixes",
    [process.argv[2]],
    { retentionDays: 1 },
  );
  console.log(`Uploaded reviewed fixes as artifact ${result.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
""".strip()
    + "\n"
)
subprocess.run(
    ["node", str(uploader), str(archive_path.resolve())],
    check=True,
)
