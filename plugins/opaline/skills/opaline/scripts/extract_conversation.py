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
    half = max_len // 2
    return text[:half] + f"\n  ... [{len(text)} chars] ...\n  " + text[-half:]


def ref_text(ref):
    if not isinstance(ref, dict):
        return "?"
    agent = ref.get("agentId") or "main"
    return f"{ref.get('sessionId', '?')}/{agent}#{ref.get('turn', '?')}"


ROLES = {
    "user_prompt": "USER",
    "assistant_text": "ASSISTANT",
    "injected_context": "CONTEXT",
    "compaction": "COMPACTION",
}
SECTION_ROLES = {
    "prompt": "USER",
    "task": "TASK",
    "final": "ASSISTANT (final)",
}


def print_section(section, max_len):
    record = section.get("record")
    text = section.get("text", "")
    if record is None:
        role = SECTION_ROLES.get(section.get("name"), section.get("name", "?").upper())
        print(f"\n[{role}]")
        print(f"  {truncate(text, max_len)}")
        return
    kind = record.get("kind", "")
    if kind == "tool_call":
        print(f"  [tool_use: {record.get('tool') or '?'}] {truncate(text, max_len)}")
    elif kind == "tool_result":
        error = " ERROR" if record.get("isError") else ""
        print(f"  [tool_result: {record.get('callId') or '?'}{error}] {truncate(text, max_len)}")
    elif kind in ("reasoning", "thinking"):
        print(f"  [thinking] {truncate(text, max_len)}")
    else:
        print(f"\n[{ROLES.get(kind, kind.upper() or '?')}]")
        print(f"  {truncate(text, max_len)}")


max_len = int(os.environ.get("MAX_LEN", "500"))

if len(sys.argv) < 2:
    print("Usage: python3 extract_conversation.py FILE", file=sys.stderr)
    sys.exit(1)

result = load_result(sys.argv[1])
tool = result.get("tool") if isinstance(result, dict) else None
if tool == "read":
    for read in result.get("reads", []):
        print(f"\n{'=' * 80}")
        print(f"Run: {ref_text(read.get('ref'))}")
        print(f"{'=' * 80}")
        for section in read.get("sections", []):
            print_section(section, max_len)
elif tool == "run":
    view = result.get("view") or {}
    print(f"\n{'=' * 80}")
    print(f"Run: {result.get('id', '?')}")
    print(f"{'=' * 80}")
    previous = view.get("previous")
    if previous and previous.get("end"):
        print("\n[ASSISTANT (previous run's end)]")
        print(f"  {truncate(previous['end'], max_len)}")
    if view.get("prompt") or view.get("task"):
        print("\n[USER]" if view.get("prompt") else "\n[TASK]")
        print(f"  {truncate(view.get('prompt') or view.get('task'), max_len)}")
    for request in view.get("requests") or []:
        for call in request.get("calls", []):
            failed = " ERROR" if call.get("failed") else ""
            print(f"  [tool_use: {call.get('tool', '?')}{failed}] @c{call.get('record', '?')}")
        if request.get("text"):
            print("\n[ASSISTANT]")
            print(f"  {truncate(request['text'].get('head', ''), max_len)}")
    following = view.get("next")
    if following and following.get("prompt"):
        print("\n[USER (next prompt)]")
        print(f"  {truncate(following['prompt'], max_len)}")
else:
    print("Not an Opaline read or run result in JSON (call it with format: \"json\").", file=sys.stderr)
    sys.exit(1)

for marker in result.get("_markers") or []:
    print(f"\n{marker}")
