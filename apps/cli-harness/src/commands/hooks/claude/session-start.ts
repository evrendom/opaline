import { readFile } from "node:fs/promises";
import { getLogger } from "@logtape/logtape";
import { buildCommand } from "@stricli/core";
import { loadCredentials } from "../../../lib/credentials.js";
import { getProjectOrgId } from "../../../lib/project-config.js";
import { captureAndUploadSessionEvidence } from "../../../lib/session-evidence.js";
import { disposeLogging, setupHookLogging } from "../../../logging.js";

interface SessionStartInput {
	readonly cwd: string;
	readonly session_id: string;
	readonly transcript_path: string;
}

async function readStdin(): Promise<string> {
	const chunks: string[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
	}
	return chunks.join("");
}

async function runSessionStart(): Promise<undefined> {
	await setupHookLogging();
	const logger = getLogger(["rudel", "cli", "hook"]);
	try {
		const raw = await readStdin();
		if (!raw.trim()) return;
		const input = JSON.parse(raw) as SessionStartInput;
		if (!input.session_id || !input.transcript_path || !input.cwd) return;
		const credentials = loadCredentials();
		if (!credentials?.user) return;
		const organizationId =
			(await getProjectOrgId(input.cwd)) ?? credentials.user.id;
		let content = "";
		try {
			content = await readFile(input.transcript_path, "utf8");
		} catch (error) {
			if (!isMissingPath(error)) throw error;
		}
		const receipt = await captureAndUploadSessionEvidence({
			credentials,
			lifecycle: "start",
			onWarning: (warning) => logger.warn("{warning}", { warning }),
			organizationId,
			request: {
				content,
				projectPath: input.cwd,
				sessionId: input.session_id,
				source: "claude_code",
				subagents: undefined,
			},
			terminalTranscript: false,
		});
		logger.info(
			"Start context accepted for session {sessionId} ({contextId})",
			{
				contextId: receipt.contextId,
				sessionId: input.session_id,
			},
		);
	} catch (error) {
		logger.warn("Claude start context capture deferred: {error}", {
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		await disposeLogging();
	}
}

function isMissingPath(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as { readonly code?: unknown }).code === "ENOENT"
	);
}

export const sessionStartCommand = buildCommand({
	loader: async () => ({ default: runSessionStart }),
	parameters: {},
	docs: { brief: "Capture Claude Code session-start context" },
});
