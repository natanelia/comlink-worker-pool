from __future__ import annotations

import base64
import io
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
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
    for path in paths:
        archive.add(path, arcname=str(path))

encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
print("PR7_REVIEW_ARCHIVE_BEGIN")
for offset in range(0, len(encoded), 120):
    print(encoded[offset : offset + 120])
print("PR7_REVIEW_ARCHIVE_END")
