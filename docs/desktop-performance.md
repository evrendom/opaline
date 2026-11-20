# Desktop app performance

Measurements of the Mac app's first launch and import, before and after the changes that set out to make them lighter (#543, #544, #545). Each section says how its numbers were taken, so they can be measured again. When a later change moves one of them, add a dated row instead of replacing it.

## Setup

All numbers below come from one Mac, measured on 2026-11-20:

- **Machine:** Apple M4, 10 cores (4 performance, 6 efficiency), 16 GB RAM, macOS 26.3.1.
- **Sessions:** 3.8 GB of Claude Code transcripts (546 files) and 4.8 GB of Codex sessions. 28 transcripts are over 48 MB on disk.
- **Largest session:** a Codex rollout of 486 MB compressed, 1.12 GiB decompressed, 69,098 lines. 922 MB of it is in 1,473 lines over 100 KB, mostly base64 screenshots and tool output. It holds 1,025 distinct images, 238 MB decoded.
- **Before:** the app published as `desktop-latest` on 2026-11-19 (server `0.18.0-desktop.a6f0177e`).
- **After:** `main` at `2651fcb8`, built with `apps/desktop/shell/package.sh`, ad-hoc signed.

Peak memory moves between runs with when the garbage collector runs, so compare ranges over several runs, not single numbers.

## Whole app, first launch on a fresh server folder

Resident memory of every Opaline process, sampled every 3 s with `apps/desktop/shell/scripts/perf/sample-memory.sh`. Each run starts on a fresh server data folder, so it does a full first import (`OPALINE_SERVER_DATA_DIR=<empty folder> OPALINE_ONBOARDING=1`).

| peak | before | after (#543, #544) |
|---|---|---|
| all Opaline processes | 5.1 GB | 1.9 GB |
| server (import) | 4.6 GB | 1.1 GB |
| onboarding analysis (`clickhouse local`) | 3.0 GB | 0.6 GB |
| ClickHouse server | 0.7 GB | 0.5 GB |
| onboarding window (renderer) | 0.3 GB | 0.4 GB |

**What each window covered:**
- **Before:** 4 minutes, including the 1.12 GiB session, which ran 2½ minutes in.
- **After:** 4½ minutes. The giant sessions now wait until the rest of the first import is in, so the largest session wasn't reached yet. Its own cost is measured in the next section.

**Import pace:** the import runs at background priority on the efficiency cores. In the after run it stored 34 of 459 sessions (199 MB) in 4 minutes. That pace predates these changes.

## One giant session

Reading the 1.12 GiB Codex session the way the import does: `bun src/scripts/measure-session-read.ts <transcript>`, run in `apps/desktop/server`. This covers reading, slimming and collecting images. It doesn't cover the secret filter or the database writes.

| | before | after (#544) |
|---|---|---|
| peak memory | 3.3–3.9 GB (3 runs) | 2.0–2.6 GB (6 runs) |
| held after a full GC | 1.64 GB | 1.17 GB |
| time | 16–17 s | 10–17 s |
| images stored | 1,025 | 1,026 |

**Why the after numbers are lower:**
- Images are now collected in one pass and kept on disk, not in memory.
- Local imports are no longer slimmed a second time in the secret filter.

**Why one more image is stored:** the old collector skipped MCP images whose line didn't contain the word "base64". The text still carried their marker, but the image was never stored.

**Not measured on its own:** the secret-filter stage. It took ~38 s either way.

## Onboarding analysis

The query behind the first onboarding screens, run with the app's bundled ClickHouse (`analyze.js`). Measured with `/usr/bin/time -l` around `analyzeSessions()`.

| | time | peak memory |
|---|---|---|
| before: all cores, Claude Code and Codex at once | 6.4 s | 3.5 GB + 0.8 GB at the same time |
| after (#543): 2 threads, one agent at a time | 10.6 s | 1.2 GB |

Results were the same: 260 Claude Code and 180 Codex sessions. Inside the app, with the server starting alongside, the analysis took 15 s on a fresh launch.

## Intro animation

`apps/desktop/shell/scripts/perf/intro-frames.mjs` launches a built app with onboarding forced and a fresh server folder. It times every `requestAnimationFrame` of the onboarding page. It also records long tasks, main-process event-loop stalls, the page's calls into the main process, and CPU per process.

### The freeze (#545)

About 1.5 s after the window appeared, the intro stopped for almost exactly one second. Same build, warm caches, 6 s per launch:

| | launches with a freeze over 200 ms | freeze length |
|---|---|---|
| before | 6 of 6 | 999–1,008 ms |
| after (`backgroundThrottling: false` on the onboarding windows) | 0 of 6 | — |

A Chromium trace of the freeze shows the cause:
- **The page kept asking for frames.** `SetNeedsAnimate` was called at 1,200 ms.
- **The GPU process stopped vsync anyway.** It unregistered `CVDisplayLinkMac` at 1,284 ms and registered it again at 2,224 ms.
- **Nothing was busy:** no slice over 100 ms in any process, no main-process stall, and the page's thread was idle.

Chromium treated the transparent, frameless window as hidden while macOS settled it in.

### Still there

- **The first second:** building the glass scene (`glass3d.js`) is a long task of 85–118 ms, so the first second shows about 37 frames instead of ~120. After that the intro holds ~120 fps, with the import and analysis taking 2–3 cores beside it.
- **Cold caches:** on the first launch of a new app bundle, the window appeared after 3.8 s, against 0.3–0.6 s on later launches.

## Startup marks

From `~/Library/Logs/Opaline/local-stack.log`. Each value is the time after launch.

| mark | before, first install | after, fresh server folder |
|---|---|---|
| `onboarding-shown` | 7.6 s | 3.8 s with cold caches, 0.3–0.6 s with warm caches |
| `server-ready` | 26.4 s | 9.5 s |
| `analysis-done` | 19.2 s | 19.0 s |

The before row is a real first install, which also unpacks the runtimes. The after runs reused runtimes that were already unpacked, so these rows aren't strictly like for like.

## Known costs not addressed yet

- **Appends:** every append to a live transcript re-imports the whole file. The reader works out the appended lines, but nothing downstream uses them.
- **Whole text in memory:** a session's text (286 MB for the session above) is held whole, more than once, through the secret filter and the raw insert.
