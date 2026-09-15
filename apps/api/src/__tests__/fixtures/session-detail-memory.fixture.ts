import { deriveSessionDetail } from "../../services/session-detail-derivation.service.js";
import { buildSessionDetailInitial } from "../../services/session-detail-initial.js";

const megabytes = Number(process.argv[2] ?? 30);
const count = Number(process.argv[3] ?? 150);
const agentMessage = process.argv[4] === "assistant";
function claudeTranscript() {
	return Array.from({ length: count }, (_, i) =>
		[
			JSON.stringify({
				type: "user",
				sessionId: "local-stress",
				uuid: `u-${i}`,
				timestamp: new Date(1760000000000 + i * 1000).toISOString(),
				message: {
					role: "user",
					content: agentMessage
						? "Inspect the result"
						: "Please inspect this output. " +
							"Text ".repeat(Math.ceil((megabytes * 1024 * 1024) / count / 5)),
				},
			}),
			JSON.stringify({
				type: "assistant",
				sessionId: "local-stress",
				uuid: `a-${i}`,
				timestamp: new Date(1760000000500 + i * 1000).toISOString(),
				message: {
					role: "assistant",
					id: `msg-${i}`,
					model: "claude-sonnet-4-5",
					content: [
						{
							type: "text",
							text: agentMessage
								? "Text ".repeat(
										Math.ceil((megabytes * 1024 * 1024) / count / 5),
									)
								: "The output is ready.",
						},
					],
					usage: { input_tokens: 100, output_tokens: 10 },
				},
			}),
		].join("\n"),
	).join("\n");
}
const source = process.argv[4] === "codex" ? "codex" : "claude_code";
const content = source === "codex" ? codexTranscript() : claudeTranscript();
const started = performance.now();
const derivation = deriveSessionDetail({
	content,
	durationMinutes: 1,
	gitBranch: null,
	gitRemote: "",
	gitSha: null,
	inputTokens: 1,
	lastInteractionDate: "2026-09-15T00:00:00.000Z",
	modelUsed: "claude-sonnet-4-5",
	organizationId: "local-stress",
	outputTokens: 1,
	ownerId: "local-stress",
	packageName: "",
	projectPath: "/stress",
	revision: "1",
	sessionDate: "2026-09-15T00:00:00.000Z",
	sessionId: "local-stress",
	skills: [],
	slashCommands: [],
	source,
	subagents: {},
	totalTokens: 2,
});
const initial = buildSessionDetailInitial(derivation);
console.log(
	JSON.stringify({
		mb: megabytes,
		turns: initial.overview.turnPage.total,
		rawBytes: Buffer.byteLength(content),
		responseBytes: Buffer.byteLength(JSON.stringify(initial)),
		durationMs: Math.round(performance.now() - started),
		memory: process.memoryUsage(),
		maxRss: process.resourceUsage().maxRSS,
	}),
);

function codexTranscript() {
	const timestamp = "2026-09-15T00:00:00.000Z";
	const text = "Text ".repeat(Math.ceil((megabytes * 1024 * 1024) / count / 5));
	return [
		JSON.stringify({
			type: "session_meta",
			timestamp,
			payload: { id: "local-stress" },
		}),
		...Array.from({ length: count }, (_, i) =>
			[
				JSON.stringify({
					type: "response_item",
					timestamp: new Date(Date.parse(timestamp) + i * 1000).toISOString(),
					payload: {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text }],
					},
				}),
				JSON.stringify({
					type: "response_item",
					timestamp: new Date(
						Date.parse(timestamp) + i * 1000 + 500,
					).toISOString(),
					payload: {
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "The output is ready." }],
					},
				}),
			].join("\n"),
		),
	].join("\n");
}
