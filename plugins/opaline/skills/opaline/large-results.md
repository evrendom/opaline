# Links, large results and scripts

- Every result of `find`, `read`, `run`, `sql`, `search` and `answers` starts with a `url:` line (`_opalineUrl` in JSON): the Opaline page that shows it. Surface it verbatim as a Markdown link with descriptive text; never build an Opaline link by hand.
- A link the user pastes (`https://opaline.so/<workspace>/sessions/<id>?turn=…`) goes to `run` as `url`. A session link with its run opens that run; a session link without one, the session list or the dashboard returns the call that opens it, keeping the link's `from` and `to`.
- Where your tools offer it, `format: "json"` on `read` and `run` returns the same data as one JSON object, with the same cut markers in `_markers` and the `_opalineUrl`. Ask for it when a result is too large to read inline.
- `agent_feedback`, where your tools offer it, tells the Opaline team about a rough edge, a missing capability or something that worked well. It does not end your turn: keep going and finish the user's task.

Both formats enforce response size limits. Check the omission and truncation markers before drawing conclusions. A dropped row or run, a column listed in `omittedColumns`, or a keyword missing from a summary is not evidence that it was absent from the session. If full detail is still truncated, narrow the call to the relevant runs or records, or open `_opalineUrl` for the complete data.

### Peek, then answer here or pull the data

The tools answer; they do not export data in bulk. Where your tools offer `peek`, do not load a list blind:

1. **Peek first.** Before a `find`, `sql`, `measures action=run` or `search` call that may be large (a month, a whole workspace, every call or prompt), make the same call with `peek: true`. It loads nothing and answers in about a second and under 1,500 characters: the rows, groups and sessions it would return, first and last time, the 5 largest groups (or first 5 rows), the size of the full result in characters and pages, and a `suggest:` line. A `counted before:` line names the arguments the count could not apply (a cause, filters, reactions), so the real result is smaller.
2. **Small** (`suggest: small`): make the call without `peek` and read it inline.
3. **Large**: aggregate first (a `groupBy`, a `GROUP BY` in sql, a measure or its `drill`) when one row per group answers the question. For many rows, pull them (`opaline pull` or `opaline sql --out`) in one go rather than paging a list tool.
4. **Pull the data when you need every row.** A peek of more than one page, a `find` with more pages, and a cut `sql` or `measures` result carry one line, `too large to page through here. If the opaline CLI is available, to compute on all of it, run: …`, naming the exact command for that call: `opaline pull --repo <repository> --from <from> --to <to>` for `find` and `measures`, `opaline sql "<the same query>" --out rows.jsonl` for `sql`. **If the `opaline` CLI is available** in your shell, run it once and compute on the files in one script that prints only the answer (counts, top N, the ids to open); then read the few runs it points to with `run` or `read`. Without a shell or the CLI, ignore the line: aggregate, narrow from/to or the filters, and say what the answer covers.

Answer CI, pull request, commit and merge questions over many sessions from a pulled slice (`git.jsonl`, `edges.jsonl` and `ci_jobs.jsonl`, with `runs.jsonl` and `calls.jsonl`) in one script. Use `find source=git` only to look up one pull request (`pullRequest=`) or one session.

### Parse large results with scripts

When the result is persisted to a file (large `read` or `run` results in JSON), use the parsing scripts in `scripts/` to explore it. **Start with the summary** to get the full picture, then drill into specifics:

```bash
# 1. Overview: totals, failed calls, prompt, final output, markers
python3 scripts/print_summary.py /path/to/persisted-file.json

# 2. Timeline: requests or records in order, with truncated text
python3 scripts/print_timeline.py /path/to/persisted-file.json

# 3. One run in full (session id, run id, or session/agent#turn)
RUN="sess-1/main#3" python3 scripts/extract_run.py /path/to/persisted-file.json

# 4. The conversation: prompts, assistant text, tool calls and results
python3 scripts/extract_conversation.py /path/to/persisted-file.json

# 5. Search for a keyword across everything returned
SEARCH="keyword" python3 scripts/search_runs.py /path/to/persisted-file.json
```

All scripts support the `MAX_LEN=N` env var to control truncation (0 = unlimited).

Results in JSON are one object. When too large to read inline, Claude Code persists them to a file. Use `depth=turn` or `depth=record` on `read` for content extraction and keyword searches. The scripts cannot recover content omitted from a summary or dropped by truncation.

#### Persisted file format

```json
[{ "type": "text", "text": "{\"tool\": \"read\", \"reads\": [...], \"_markers\": [...], \"_opalineUrl\": \"...\"}" }]
```

| Script | Purpose | Usage |
| --- | --- | --- |
| `print_summary.py` | Totals, failed calls, prompt and final output, cut markers, link | `python3 scripts/print_summary.py FILE` |
| `print_timeline.py` | A run's requests or records in order, with their text cut short | `python3 scripts/print_timeline.py FILE` |
| `extract_run.py` | One run's full sections, view or row | `RUN="id" python3 scripts/extract_run.py FILE` |
| `extract_conversation.py` | Prompts, assistant text, tool calls and results by role | `python3 scripts/extract_conversation.py FILE` |
| `search_runs.py` | A keyword anywhere, with its path and run | `SEARCH="keyword" python3 scripts/search_runs.py FILE` |
| `show_structure.py` | JSON keys and types without values | `cat FILE \| python3 scripts/show_structure.py` |
