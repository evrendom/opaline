import type {
	LocalSessionInputRequest,
	PreparedLocalSession,
} from "../../services/local-session-input.types.js";
import { collectSessionImages } from "./image-collection.js";
import { buildLocalSessionInput } from "./session-input.js";

export async function prepareLocalSession(
	request: LocalSessionInputRequest,
): Promise<PreparedLocalSession> {
	const built = await buildLocalSessionInput(request);
	if (built.kind === "skipped") return built;
	const images = collectSessionImages([
		{ agentId: "", content: built.input.content },
		...(built.input.subagents ?? []).map((subagent) => ({
			agentId: subagent.agentId,
			content: subagent.content,
		})),
	]);
	return { ...built, images };
}
