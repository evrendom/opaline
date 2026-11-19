import { useSyncExternalStore } from "react";
import type { CliConnectionSnapshot } from "../../../../../../packages/api-routes/src/cli-connection";
import type { CliAuthorization } from "../cli-onboarding/cli-authorization";
import type { WelcomeRepository } from "./welcome-selection";

export const DEV_STAGES = [
	{ id: "picker-loading", label: "Loading repositories", group: "flow" },
	{ id: "choose", label: "Choose repositories", group: "flow" },
	{ id: "picker-connecting", label: "Connecting", group: "flow" },
	{ id: "sign-in", label: "Sign in", group: "flow" },
	{ id: "github", label: "GitHub", group: "flow" },
	{ id: "profile", label: "Profile", group: "flow" },
	{ id: "invite", label: "Invite teammates", group: "flow" },
	{ id: "completed", label: "Done", group: "flow" },
	{ id: "picker-error", label: "Connect failed", group: "edge" },
	{ id: "picker-load-error", label: "Can't read repositories", group: "edge" },
	{ id: "interrupted", label: "Setup interrupted", group: "edge" },
	{ id: "expired", label: "Connection expired", group: "edge" },
	{ id: "device", label: "Device sign-in", group: "edge" },
] as const;

export type DevStage = (typeof DEV_STAGES)[number]["id"];

let current: DevStage | null = null;
const listeners = new Set<() => void>();

export function setDevStage(next: DevStage | null) {
	current = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useDevStage(): DevStage | null {
	return useSyncExternalStore(
		subscribe,
		() => (import.meta.env.DEV ? current : null),
		() => null,
	);
}

const CONNECTION_ID = "00000000-0000-4000-8000-000000000001";

const SAMPLE_REPOSITORIES: WelcomeRepository[] = [
	{
		key: "sample-web",
		name: "web-app",
		sessionCount: 42,
		sources: ["claude_code"],
	},
	{
		key: "sample-api",
		name: "api-server",
		sessionCount: 27,
		sources: ["codex"],
	},
	{
		key: "sample-docs",
		name: "docs",
		sessionCount: 9,
		sources: ["claude_code", "codex"],
	},
];

let lastSelection: WelcomeRepository[] = [];

const SNAPSHOT_STATES: Partial<
	Record<DevStage, CliConnectionSnapshot["state"]>
> = {
	"sign-in": "awaiting_login",
	github: "ready",
	profile: "uploading",
	invite: "uploading",
	completed: "completed",
	interrupted: "cancelled",
	expired: "expired",
};

const WELCOME_STEPS: Partial<
	Record<DevStage, "workspace" | "github" | "profile" | "invite" | "done">
> = {
	"sign-in": "workspace",
	github: "github",
	profile: "profile",
	invite: "invite",
	completed: "done",
};

export type DevOnboardingOverride = {
	snapshot: CliConnectionSnapshot | null;
	authorization: CliAuthorization | null;
	deviceUserCode: string | null;
	connectionError: string | null;
};

export function devOnboardingOverride(
	stage: DevStage,
	selection: WelcomeRepository[],
	organizationId: string | null,
	userId: string | null,
): DevOnboardingOverride | null {
	if (
		stage === "choose" ||
		stage === "picker-loading" ||
		stage === "picker-connecting" ||
		stage === "picker-error" ||
		stage === "picker-load-error"
	)
		return {
			snapshot: null,
			authorization: null,
			deviceUserCode: null,
			connectionError: null,
		};
	if (stage === "device")
		return {
			snapshot: null,
			authorization: null,
			deviceUserCode: "ABCD-EFGH",
			connectionError: null,
		};
	if (selection.length) lastSelection = selection;
	const source = lastSelection.length ? lastSelection : SAMPLE_REPOSITORIES;
	const repositories = source.map((repository, index) => ({
		id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
		name: repository.name,
		sessionCount: repository.sessionCount,
		enabled: true,
		sources: (repository.sources.length
			? repository.sources
			: ["claude_code"]
		).filter(
			(source): source is "claude_code" | "codex" =>
				source === "claude_code" || source === "codex",
		),
	}));
	const total = repositories.reduce((sum, repo) => sum + repo.sessionCount, 0);
	const state = SNAPSHOT_STATES[stage];
	if (!state) return null;
	const now = new Date().toISOString();
	const connectionId = `${CONNECTION_ID.slice(0, -2)}${String(
		DEV_STAGES.findIndex((item) => item.id === stage) + 10,
	).padStart(2, "0")}`;
	const step = WELCOME_STEPS[stage];
	if (step && userId)
		try {
			localStorage.setItem(
				`opaline.welcome.${connectionId}.${userId}`,
				JSON.stringify({
					step,
					organizationId: step === "workspace" ? null : organizationId,
					github: "pending",
				}),
			);
		} catch {}
	const snapshot: CliConnectionSnapshot = {
		id: connectionId,
		browserOrigin: window.location.origin,
		state,
		revision: 1,
		createdAt: now,
		expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
		lastSeenAt: now,
		repositories,
		organizationId: ["sign-in", "interrupted", "expired"].includes(stage)
			? null
			: organizationId,
		totals:
			stage === "profile" || stage === "invite"
				? { uploaded: Math.round(total / 3), skipped: 0, failed: 0 }
				: stage === "completed"
					? { uploaded: total, skipped: 0, failed: 0 }
					: null,
		failureReason: null,
	};
	return {
		snapshot,
		authorization: step ? { id: connectionId, userCode: "ABCD-EFGH" } : null,
		deviceUserCode: null,
		connectionError: null,
	};
}
