import type {
	LocalSessionInputRequest,
	PreparedLocalSession,
} from "../../services/local-session-input.types.js";
import { buildLocalSessionInput } from "./session-input.js";

export function prepareLocalSession(
	request: LocalSessionInputRequest,
): Promise<PreparedLocalSession> {
	return buildLocalSessionInput(request);
}
