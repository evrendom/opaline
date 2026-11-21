import { homedir } from "node:os";
import { sep } from "node:path";
import {
	type CleanupReport,
	type Environment,
	findLeftovers,
	hasLeftovers,
	type Leftovers,
	retire,
} from "@rudel/cli-retire";

/** Detection reads a few small files; agents and the banner ask often. */
const CACHE_MS = 60_000;

export const RETIRED_CLI_MCP_INSTRUCTION =
	"This Mac still has the retired Opaline CLI, which tries to send sessions to Opaline's shut-down cloud. Tell the user once and offer to remove it: run `npx opaline@latest`, or use Remove in the Opaline app. Opaline itself does not need it.";

export interface RetiredCliRemoval {
	/** One line per thing removed, paths shortened to `~`. */
	readonly removed: string[];
	/** Files left alone because they could not be parsed or kept changing. */
	readonly skipped: string[];
	/** Another CLI process held its settings lock; only the sign-in was removed. */
	readonly busy: boolean;
	/** Whether anything is still found after the cleanup. */
	readonly present: boolean;
}

export interface RetiredCli {
	/** Cached for a minute; never writes. */
	present(): boolean;
	/** Runs the CLI's own cleanup for this user. Idempotent. */
	remove(): RetiredCliRemoval;
}

export interface RetiredCliOptions {
	/** Read at each call, so tests and the app's environment both apply. */
	readonly env?: () => Environment;
	readonly now?: () => number;
	readonly cacheMs?: number;
}

export function createRetiredCli(options: RetiredCliOptions = {}): RetiredCli {
	const env = options.env ?? (() => process.env);
	const now = options.now ?? Date.now;
	const cacheMs = options.cacheMs ?? CACHE_MS;
	let cached: { at: number; leftovers: Leftovers } | undefined;

	function context() {
		const current = env();
		return { env: current, home: current.HOME?.trim() || homedir() };
	}

	function leftovers(): Leftovers {
		const at = now();
		if (cached && at - cached.at < cacheMs) return cached.leftovers;
		cached = { at, leftovers: findLeftovers(context()) };
		return cached.leftovers;
	}

	return {
		present: () => hasLeftovers(leftovers()),
		remove() {
			const { env: current, home } = context();
			// The server's own folder is no CLI project, so the home stands in
			// for the working directory: its settings are the global ones.
			const report = retire({
				env: current,
				home,
				cwd: home,
				argv1: undefined,
				// The app never installs or refreshes a CLI runtime.
				bundlePath: undefined,
			});
			cached = undefined;
			return {
				...describeRemoval(report, home),
				present: hasLeftovers(leftovers()),
			};
		},
	};
}

export function describeRemoval(
	report: CleanupReport,
	home: string,
): Omit<RetiredCliRemoval, "present"> {
	const short = (path: string) =>
		path === home || path.startsWith(`${home}${sep}`)
			? `~${path.slice(home.length)}`
			: path;
	const removed = [
		...report.signedOut.map(
			(dir) => `The CLI's saved sign-in from ${short(dir)}`,
		),
		...report.changed.map(
			(change) => `${capitalize(change.what)} from ${short(change.path)}`,
		),
		...report.stateRemoved.map(
			({ configDir, names }) =>
				`${names.length} cloud upload file${names.length === 1 ? "" : "s"} from ${short(configDir)}`,
		),
	];
	return {
		removed,
		skipped: report.skipped.map(
			({ path, reason }) => `${short(path)} (${reason})`,
		),
		busy: report.busy,
	};
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export const retiredCli = createRetiredCli();
