import type { SessionPullRequest, SessionRunCiRun } from "@rudel/api-routes";
import type { DemoRunCiSession } from "./demo-run-ci-builders.js";
import { DEMO_RUN_CI } from "./demo-run-ci-sessions.js";

export interface RunCiDemoSource {
	readonly workspaceId: string;
	runs(sessionId: string): SessionRunCiRun[];
	pullRequests(sessionId: string): SessionPullRequest[];
}

export function runCiDemoSource(
	workspaceId: string | undefined,
	sessions: Readonly<Record<string, DemoRunCiSession>> = DEMO_RUN_CI,
): RunCiDemoSource | undefined {
	if (!workspaceId) return undefined;
	const session = (sessionId: string) =>
		Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : undefined;
	return {
		workspaceId,
		runs: (sessionId) => structuredClone([...(session(sessionId)?.runs ?? [])]),
		pullRequests: (sessionId) =>
			structuredClone([...(session(sessionId)?.pullRequests ?? [])]),
	};
}

export function runCiDemoFromEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
): RunCiDemoSource | undefined {
	return runCiDemoSource(environment.DEMO_ORGANIZATION_ID?.trim());
}

export function runCiDemoOf(
	env: { readonly demo?: RunCiDemoSource },
	workspaceId: string,
): RunCiDemoSource | undefined {
	return env.demo && env.demo.workspaceId === workspaceId
		? env.demo
		: undefined;
}

export function withDemoPullRequests(
	real: readonly SessionPullRequest[],
	demo: readonly SessionPullRequest[],
): SessionPullRequest[] {
	const key = (pull: SessionPullRequest) => `${pull.repository}#${pull.number}`;
	const scripted = new Set(demo.map(key));
	return [...real.filter((pull) => !scripted.has(key(pull))), ...demo].sort(
		(a, b) => a.repository.localeCompare(b.repository) || a.number - b.number,
	);
}
