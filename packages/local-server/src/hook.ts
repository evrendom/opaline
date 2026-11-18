import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getLocalServerUrl } from "./server-runner.js";
import { loadServerState, resolveServerDataDir } from "./server-state.js";

const NOTIFY_TIMEOUT_MS = 1_500;
const CODEX_DAYS_BACK = 2;

export type HookAgent = "claude" | "codex";

export interface HookInput {
	readonly paths: readonly string[];
	readonly final: boolean;
	readonly stopped: boolean;
}

const TURN_ENDS = new Set(["Stop", "SessionEnd"]);

export function claudeHookInput(raw: string): HookInput | null {
	try {
		const value = JSON.parse(raw) as {
			transcript_path?: unknown;
			hook_event_name?: unknown;
		};
		if (typeof value.transcript_path !== "string" || !value.transcript_path)
			return null;
		return {
			paths: [value.transcript_path],
			final: value.hook_event_name === "SessionEnd",
			stopped: TURN_ENDS.has(String(value.hook_event_name)),
		};
	} catch {
		return null;
	}
}

export function codexHookInput(
	raw: string,
	codexHome: string,
	now = new Date(),
): HookInput | null {
	let value: Record<string, unknown>;
	try {
		value = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const final = value.hook_event_name === "SessionEnd";
	const stopped = TURN_ENDS.has(String(value.hook_event_name));
	if (typeof value.transcript_path === "string" && value.transcript_path)
		return { paths: [value.transcript_path], final, stopped };
	const threadId = value.session_id ?? value["thread-id"];
	if (typeof threadId !== "string" || !/^[\w-]+$/u.test(threadId)) return null;
	for (let back = 0; back <= CODEX_DAYS_BACK; back++) {
		const day = new Date(now.getTime() - back * 86_400_000);
		const directory = join(
			codexHome,
			"sessions",
			String(day.getFullYear()),
			String(day.getMonth() + 1).padStart(2, "0"),
			String(day.getDate()).padStart(2, "0"),
		);
		try {
			const match = readdirSync(directory).find(
				(name) => name.endsWith(".jsonl") && name.includes(threadId),
			);
			if (match) return { paths: [join(directory, match)], final, stopped };
		} catch {}
	}
	return null;
}

export async function notifyLocalServer(
	input: HookInput,
	options: {
		readonly dataDir?: string;
		readonly env?: NodeJS.ProcessEnv;
		readonly home?: string;
		readonly fetchImpl?: typeof fetch;
	} = {},
): Promise<boolean> {
	const env = options.env ?? process.env;
	const state = loadServerState(
		resolveServerDataDir(options.dataDir, env, options.home ?? homedir()),
	);
	if (!state?.setup) return false;
	try {
		const response = await (options.fetchImpl ?? fetch)(
			`${getLocalServerUrl(state)}/api/selfhost/ingest/notify`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-api-key": state.setup.apiKey,
				},
				body: JSON.stringify(input),
				signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
			},
		);
		await response.arrayBuffer().catch(() => undefined);
		return response.status === 202;
	} catch {
		return false;
	}
}
