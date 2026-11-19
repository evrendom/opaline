import json
import os
import sys


def load_result(path):
    with open(path) as f:
        raw = json.load(f)
    if isinstance(raw, list) and raw and isinstance(raw[0], dict) and raw[0].get("type") == "text":
        raw = json.loads(raw[0]["text"])
    return raw


def ref_text(ref):
    if not isinstance(ref, dict):
        return None
    agent = ref.get("agentId") or "main"
    return f"{ref.get('sessionId', '?')}/{agent}#{ref.get('turn', '?')}"


def search_obj(obj, term, path="", run=None):
    if isinstance(obj, str):
        lower = obj.lower()
        if term in lower:
            idx = lower.index(term)
            start, end = max(0, idx - 80), min(len(obj), idx + len(term) + 80)
            yield run, path, obj[start:end]
    elif isinstance(obj, dict):
        run = ref_text(obj.get("ref")) or run
        for k, v in obj.items():
            yield from search_obj(v, term, f"{path}.{k}", run)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from search_obj(v, term, f"{path}[{i}]", run)


term = os.environ.get("SEARCH", "").lower()
if not term or len(sys.argv) < 2:
    print("Usage: SEARCH='keyword' python3 search_runs.py FILE", file=sys.stderr)
    sys.exit(1)

result = load_result(sys.argv[1])
top = ref_text(result.get("ref")) if isinstance(result, dict) else None
hits = 0
for run, path, snippet in search_obj(result, term, "", top):
    hits += 1
    print(f"\n[{run or '-'}] {path}")
    print(f"  ...{snippet}...")
if hits == 0:
    print(f"No match for '{term}'. Check the cut markers before concluding it is absent:", file=sys.stderr)
for marker in (result.get("_markers") or []) if isinstance(result, dict) else []:
    print(marker, file=sys.stderr)
