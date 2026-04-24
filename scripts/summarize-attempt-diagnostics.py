#!/usr/bin/env python3

import argparse
import json
from collections import Counter
from pathlib import Path


def load_rows(path: Path):
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def is_failure(diagnostic):
    outcome = diagnostic.get("outcome", "")
    status_code = diagnostic.get("statusCode", 0)
    if outcome != "success":
        return True
    return isinstance(status_code, int) and status_code >= 400


def print_counter(title, counter, limit=10):
    print(title)
    if not counter:
      print("  <none>")
      return
    for key, value in counter.most_common(limit):
        print(f"  {value:>4}  {key}")


def main():
    parser = argparse.ArgumentParser(description="Summarize persisted Antigravity proxy attempt diagnostics.")
    parser.add_argument(
        "--path",
        default=str(Path.home() / "Library/Logs/antigravity-cloudcode-proxy-attempts.jsonl"),
        help="Path to the attempt diagnostic JSONL file.",
    )
    parser.add_argument(
        "--stream-only",
        action="store_true",
        help="Only include streamGenerateContent requests.",
    )
    args = parser.parse_args()

    rows = load_rows(Path(args.path))
    diagnostics = []
    for row in rows:
        diagnostic = row.get("diagnostic") or {}
        path = diagnostic.get("path", "")
        if args.stream_only and "streamGenerateContent" not in path:
            continue
        diagnostics.append(diagnostic)

    failures = [entry for entry in diagnostics if is_failure(entry)]

    print(f"source: {args.path}")
    print(f"attempts: {len(diagnostics)}")
    print(f"failures: {len(failures)}")
    print()

    print_counter("Outcomes", Counter(entry.get("outcome", "<missing>") for entry in diagnostics))
    print()
    print_counter("Failure status codes", Counter(entry.get("statusCode", 0) for entry in failures))
    print()
    print_counter(
        "Failure upstream IPs",
        Counter(entry.get("upstream", {}).get("remoteAddress", "<missing>") for entry in failures),
    )
    print()
    print_counter(
        "Failure models",
        Counter(entry.get("model") or "<none>" for entry in failures),
    )
    print()
    print_counter(
        "Failure x-goog-api-client",
        Counter(entry.get("requestHeaders", {}).get("x-goog-api-client", "<missing>") for entry in failures),
    )


if __name__ == "__main__":
    main()
