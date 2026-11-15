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
}

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
	let threadId: unknown;
	try {
		threadId = (JSON.parse(raw) as { "thread-id"?: unknown })["thread-id"];
	} catch {
		return null;
	}
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
				(name) => name.endsWith(".jsonl") && name.includes(threadId as string),
			);
			if (match) return { paths: [join(directory, match)], final: false };
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
