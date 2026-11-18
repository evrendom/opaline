import json
import os
import sys


def load_result(path):
    with open(path) as f:
        raw = json.load(f)
    if isinstance(raw, list) and raw and isinstance(raw[0], dict) and raw[0].get("type") == "text":
        raw = json.loads(raw[0]["text"])
    return raw


def summarize(val, max_len=500):
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


def print_markers(result):
    markers = result.get("_markers") or []
    if markers:
        print(f"\n{'!' * 80}")
        print("  CUT OR OMITTED — not evidence of absence:")
        for marker in markers:
            print(f"    {marker}")
        print(f"{'!' * 80}")


def print_read(result, max_len):
    reads = result.get("reads", [])
    print(f"{'=' * 80}")
    print("READ SUMMARY")
    print(f"{'=' * 80}")
    print(f"  Runs:      {len(reads)}")
    print(f"  Truncated: {result.get('truncated', '?')}")
    if result.get("_opalineUrl"):
        print(f"  Opaline URL: {result['_opalineUrl']}")
    print_markers(result)
    for read in reads:
        print(f"\n{'=' * 80}")
        print(f"RUN {ref_text(read.get('ref'))}  found={read.get('found')}  truncated={read.get('truncated')}")
        print(f"{'=' * 80}")
        print(f"  {summarize(read.get('header'), max_len)}")
        if read.get("_opalineUrl"):
            print(f"  Opaline URL: {read['_opalineUrl']}")
        sections = read.get("sections", [])
        errors = [s for s in sections if (s.get("record") or {}).get("isError")]
        if errors:
            print(f"\n  ERRORS: {len(errors)}")
            for section in errors:
                record = section["record"]
                print(f"    - {record.get('tool') or record.get('kind')} @{record.get('index')}.{record.get('block')}: {summarize(section.get('text'), max_len)}")
        else:
            print("\n  Errors:    None")
        for section in sections:
            if section.get("record") is None and section.get("name") in ("prompt", "task", "failed", "final", "next"):
                print(f"\n  [{section['name']}] {summarize(section.get('text'), max_len)}")


def print_run(result, max_len):
    view = result.get("view") or {}
    requests = view.get("requests") or []
    calls = [call for request in requests for call in request.get("calls", [])]
    failed = [call for call in calls if call.get("failed")]
    print(f"{'=' * 80}")
    print("RUN SUMMARY")
    print(f"{'=' * 80}")
    print(f"  ID:        {result.get('id', '?')}")
    print(f"  Run:       {ref_text(result.get('ref'))}")
    print(f"  Agent:     {view.get('agent', '?')}")
    print(f"  Minutes:   {view.get('minutes', '?')}")
    print(f"  Tokens:    {view.get('tokens', '?')}")
    print(f"  Cost:      ${view.get('costUsd', '?')}")
    print(f"  Requests:  {len(requests)}  Calls: {len(calls)}  Failed: {len(failed)}")
    print(f"  Truncated: {result.get('truncated', '?')}")
    if result.get("_opalineUrl"):
        print(f"  Opaline URL: {result['_opalineUrl']}")
    print_markers(result)
    if view.get("prompt") or view.get("task"):
        label = "prompt" if view.get("prompt") else "task"
        print(f"\n--- {label} ---\n  {summarize(view.get('prompt') or view.get('task'), max_len)}")
    previous = view.get("previous")
    if previous:
        print(f"\n--- previous run ended ---\n  {summarize(previous.get('end'), max_len)}")
    if failed:
        print(f"\n{'!' * 80}")
        print(f"  FAILED CALLS: {len(failed)}")
        for call in failed:
            print(f"    - {call.get('tool', '?')} ({call.get('commandClass', '')}) @r{call.get('record', '?')}")
        print(f"{'!' * 80}")
    else:
        print("\n  Failed calls: None")
    texts = [request["text"] for request in requests if request.get("text")]
    if texts:
        print(f"\n{'=' * 80}")
        print("LAST ASSISTANT TEXT")
        print(f"{'=' * 80}")
        print(f"  {summarize(texts[-1].get('head'), max_len * 2)}")
    following = view.get("next")
    if following:
        print(f"\n--- next prompt ---\n  {summarize(following.get('prompt'), max_len)}")


max_len = int(os.environ.get("MAX_LEN", "500"))

if len(sys.argv) < 2:
    print("Usage: python3 print_summary.py FILE", file=sys.stderr)
    sys.exit(1)

result = load_result(sys.argv[1])
tool = result.get("tool") if isinstance(result, dict) else None
if tool == "read":
    print_read(result, max_len)
elif tool == "run":
    print_run(result, max_len)
else:
    print("Not an Opaline read or run result in JSON (call it with format: \"json\").", file=sys.stderr)
    sys.exit(1)
