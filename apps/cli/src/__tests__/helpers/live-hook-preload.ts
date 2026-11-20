import { ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import { DEFAULT_LIVE_SESSION_FOLLOWER_TIMING } from "../../lib/live-session-follower.js";

/**
 * Preloaded into hook processes. The hooks start the detached follower with
 * the runtime flags of their own process (`process.execArgv`), so this
 * reaches the launcher and the follower too.
 */

// Only the waits between the follower's passes are shortened (production:
// 1 s tick, 500 ms debounce, 300 ms before the final read of an ended
// session); every decision it makes stays the same.
Object.assign(DEFAULT_LIVE_SESSION_FOLLOWER_TIMING, {
	debounceMs: 20,
	finalReadDelayMs: 50,
	tickMs: 50,
});

// Every `node:child_process` spawn goes through `ChildProcess#spawn`. Its
// arguments are logged synchronously, so once a hook has exited, the log
// holds every process it started.
const spawnLog = process.env.OPALINE_TEST_SPAWN_LOG;
if (spawnLog) {
	const prototype = ChildProcess.prototype as unknown as {
		spawn(options: { readonly args?: readonly string[] }): unknown;
	};
	const spawn = prototype.spawn;
	prototype.spawn = function (options) {
		appendFileSync(spawnLog, `${JSON.stringify(options.args ?? [])}\n`);
		return spawn.call(this, options);
	};
}
