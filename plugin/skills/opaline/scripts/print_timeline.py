import json
import os
import sys


def load_result(path):
    with open(path) as f:
        raw = json.load(f)
    if isinstance(raw, list) and raw and isinstance(raw[0], dict) and raw[0].get("type") == "text":
        raw = json.loads(raw[0]["text"])
    return raw


def summarize(val, max_len=200):
    if val is None:
        return ""
    s = json.dumps(val, default=str) if not isinstance(val, str) else val
    if max_len <= 0:
        return s
    return s[:max_len] + "..." if len(s) > max_len else s


def ref_text(ref):
    if not isinstance(ref, dict):
        return "?"
    agent = ref.get("agentId") or "main"
    return f"{ref.get('sessionId', '?')}/{agent}#{ref.get('turn', '?')}"


def run_timeline(result, max_len):
    view = result.get("view") or {}
    print(f"\n{'=' * 80}")
    print(f"Run: {result.get('id', '?')}  agent={view.get('agent', '?')}  minutes={view.get('minutes', '?')}  cost={view.get('costUsd', '?')}")
    print(f"{'=' * 80}")
    if view.get("prompt") or view.get("task"):
        print(f"  Prompt: {summarize(view.get('prompt') or view.get('task'), max_len)}")
    requests = sorted(view.get("requests") or [], key=lambda r: r.get("startedMs", 0))
    start = requests[0].get("startedMs", 0) if requests else 0
    for i, request in enumerate(requests, 1):
        calls = request.get("calls", [])
        seconds = (request.get("endedMs", 0) - request.get("startedMs", 0)) / 1000
        offset = (request.get("startedMs", 0) - start) / 1000
        error = " ERR" if any(call.get("failed") for call in calls) else ""
        print(f"\n{i:>3}. [request] q{request.get('record', '?')}  +{offset:.1f}s  ({seconds:.1f}s){error}")
        for call in calls:
            failed = " ERR" if call.get("failed") else ""
            print(f"     IN:  {call.get('tool', '?')} {call.get('commandClass', '')} @c{call.get('record', '?')}{failed}")
        if request.get("text"):
            print(f"     OUT: {summarize(request['text'].get('head'), max_len)}")
        if request.get("tokens") is not None:
            print(f"     tokens: {request.get('tokens')}  cost=${request.get('costUsd', '?')}")


def read_timeline(result, max_len):
    for read in result.get("reads", []):
        print(f"\n{'=' * 80}")
        print(f"Run: {ref_text(read.get('ref'))}  found={read.get('found')}  truncated={read.get('truncated')}")
        print(f"{'=' * 80}")
        print(f"  {summarize(read.get('header'), max_len)}")
        for i, section in enumerate(read.get("sections", []), 1):
            record = section.get("record")
            if record:
                name = record.get("tool") or record.get("path") or ""
                error = " ERR" if record.get("isError") else ""
                cut = " CUT" if record.get("cut") else ""
                print(f"\n{i:>3}. [{record.get('kind', '?')}] {name}  (@{record.get('index')}.{record.get('block')}){error}{cut}")
            else:
                print(f"\n{i:>3}. [{section.get('name', '?')}]")
            print(f"     {summarize(section.get('text'), max_len)}")


max_len = int(os.environ.get("MAX_LEN", "200"))

if len(sys.argv) < 2:
    print("Usage: python3 print_timeline.py FILE", file=sys.stderr)
    sys.exit(1)

result = load_result(sys.argv[1])
tool = result.get("tool") if isinstance(result, dict) else None
if tool == "run":
    run_timeline(result, max_len)
elif tool == "read":
    read_timeline(result, max_len)
else:
    print("Not an Opaline read or run result in JSON (call it with format: \"json\").", file=sys.stderr)
    sys.exit(1)
for marker in result.get("_markers") or []:
    print(f"\n{marker}")
