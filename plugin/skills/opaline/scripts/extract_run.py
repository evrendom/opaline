import json
import os
import sys


def load_result(path):
    with open(path) as f:
        raw = json.load(f)
    if isinstance(raw, list) and raw and isinstance(raw[0], dict) and raw[0].get("type") == "text":
        raw = json.loads(raw[0]["text"])
    return raw


def truncate(text, max_len):
    if max_len <= 0 or len(text) <= max_len:
        return text
    return text[:max_len] + f"... [{len(text)} chars total]"


def ref_text(ref):
    if not isinstance(ref, dict):
        return "?"
    agent = ref.get("agentId") or "main"
    return f"{ref.get('sessionId', '?')}/{agent}#{ref.get('turn', '?')}"


def matches(run_filter, *values):
    return any(run_filter in str(value).lower() for value in values if value is not None)


run_filter = os.environ.get("RUN", "").lower()
if not run_filter or len(sys.argv) < 2:
    print("Usage: RUN='session id, run id or session/agent#turn' python3 extract_run.py FILE", file=sys.stderr)
    sys.exit(1)

max_len = int(os.environ.get("MAX_LEN", "0"))
result = load_result(sys.argv[1])
tool = result.get("tool") if isinstance(result, dict) else None
found = 0

if tool == "read":
    for read in result.get("reads", []):
        ref = read.get("ref")
        if not matches(run_filter, ref_text(ref), json.dumps(ref)):
            continue
        found += 1
        print(f"\n{'=' * 80}")
        print(f"RUN: {ref_text(ref)}  found={read.get('found')}  truncated={read.get('truncated')}")
        if read.get("_opalineUrl"):
            print(f"Opaline URL: {read['_opalineUrl']}")
        print(f"{'=' * 80}")
        print(read.get("header", ""))
        for section in read.get("sections", []):
            record = section.get("record")
            if record:
                error = " [ERROR]" if record.get("isError") else ""
                print(f"\n--- @{record.get('index')}.{record.get('block')} {record.get('kind')} {record.get('tool') or ''} {record.get('path') or ''}{error} ---")
            else:
                print(f"\n--- {section.get('name', '?')} ---")
            print(truncate(section.get("text", ""), max_len))
elif tool == "run":
    if matches(run_filter, result.get("id"), ref_text(result.get("ref")), json.dumps(result.get("ref"))):
        found += 1
        print(f"\n{'=' * 80}")
        print(f"RUN: {result.get('id', '?')}  ({ref_text(result.get('ref'))})")
        if result.get("_opalineUrl"):
            print(f"Opaline URL: {result['_opalineUrl']}")
        print(f"{'=' * 80}")
        print("\n--- VIEW ---")
        print(truncate(result.get("text", ""), max_len))
        if result.get("view") is not None:
            print("\n--- STRUCTURE ---")
            print(truncate(json.dumps(result["view"], indent=2, default=str), max_len))
else:
    print("Not an Opaline read or run result in JSON (call it with format: \"json\").", file=sys.stderr)
    sys.exit(1)

for marker in result.get("_markers") or []:
    print(f"\n{marker}")

if found == 0:
    print(f"No run matching '{run_filter}' found.", file=sys.stderr)
    sys.exit(1)
