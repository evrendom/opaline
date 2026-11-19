// Onboarding dev mode (`bun run dev:onboarding`, then /dev/onboarding): every
// /welcome state, signed in or out, without an account, a database or a
// terminal. Fixture API answers plus a floating state picker. Dev-only;
// production builds never load this file.

import type { IncomingMessage, ServerResponse } from "node:http";

export const ONBOARDING_SCENARIO_COOKIE = "opaline-onboarding-dev-scenario";

/** Entry point: opens the onboarding in its first state, picker included. */
export const ONBOARDING_DEV_PATH = "/dev/onboarding";

const CONNECTION_ID = "3f1c2a7e-9b4d-4c61-8a2f-5d0e6b7c8a91";
const USER_CODE = "ABCD-1234";
const USER_ID = "user-onboarding-dev";

type ConnectionState =
	| "waiting"
	| "awaiting_login"
	| "ready"
	| "uploading"
	| "failed";

type Scenario = {
	label: string;
	group: "Terminal" | "Sign in" | "Setup";
	signedIn: boolean;
	/** Query string the welcome page opens with. */
	search: string;
	connection: ConnectionState;
	/** Saved welcome progress, for the signed-in setup steps. */
	step?: "workspace" | "github" | "profile" | "invite" | "done";
};

const paired = `?connect=${CONNECTION_ID}&user_code=${USER_CODE}`;

export const ONBOARDING_SCENARIOS = {
	ready: {
		label: "Ready for sessions",
		group: "Terminal",
		signedIn: false,
		search: "",
		connection: "waiting",
	},
	"awaiting-login": {
		label: "Continue to sign in",
		group: "Terminal",
		signedIn: false,
		search: "",
		connection: "awaiting_login",
	},
	timeout: {
		label: "Connection timeout",
		group: "Terminal",
		signedIn: false,
		search: "",
		connection: "failed",
	},
	"sign-in": {
		label: "Sign in (paired)",
		group: "Sign in",
		signedIn: false,
		search: paired,
		connection: "ready",
	},
	"device-sign-in": {
		label: "Device sign-in",
		group: "Sign in",
		signedIn: false,
		search: `?user_code=${USER_CODE}`,
		connection: "ready",
	},
	device: {
		label: "Device approval",
		group: "Sign in",
		signedIn: true,
		search: `?user_code=${USER_CODE}`,
		connection: "ready",
	},
	workspace: {
		label: "Workspace",
		group: "Setup",
		signedIn: true,
		search: paired,
		connection: "ready",
		step: "workspace",
	},
	github: {
		label: "GitHub",
		group: "Setup",
		signedIn: true,
		search: paired,
		connection: "ready",
		step: "github",
	},
	profile: {
		label: "Profile",
		group: "Setup",
		signedIn: true,
		search: paired,
		connection: "ready",
		step: "profile",
	},
	invite: {
		label: "Invite",
		group: "Setup",
		signedIn: true,
		search: paired,
		connection: "ready",
		step: "invite",
	},
	done: {
		label: "Done",
		group: "Setup",
		signedIn: true,
		search: paired,
		// Still uploading, so the page shows its done step instead of
		// handing over to the dashboard.
		connection: "uploading",
		step: "done",
	},
} satisfies Record<string, Scenario>;

type ScenarioId = keyof typeof ONBOARDING_SCENARIOS;

function readScenario(request: IncomingMessage): Scenario {
	const cookie = request.headers.cookie ?? "";
	const match = cookie.match(
		new RegExp(`(?:^|;\\s*)${ONBOARDING_SCENARIO_COOKIE}=([^;]+)`, "u"),
	);
	const id = decodeURIComponent(match?.[1] ?? "") as ScenarioId;
	// A first visit opens /welcome without a pairing: the "ready" state.
	return ONBOARDING_SCENARIOS[id] ?? ONBOARDING_SCENARIOS.ready;
}

const workspace = {
	id: USER_ID,
	name: "Evren's workspace",
	slug: "evren",
	logo: null,
	createdAt: "2026-10-01T10:00:00.000Z",
	metadata: null,
};

function snapshot(scenario: Scenario, id = CONNECTION_ID) {
	const now = new Date();
	const signedInSetup = scenario.signedIn && scenario.step !== "workspace";
	return {
		id,
		browserOrigin: "http://localhost:4011",
		state: scenario.connection,
		revision: 3,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
		lastSeenAt: now.toISOString(),
		repositories: [
			{
				id: "a1b2c3d4-0000-4000-8000-000000000001",
				name: "opalinehq/athena",
				sessionCount: 412,
				enabled: true,
				sources: ["claude_code", "codex"],
			},
			{
				id: "a1b2c3d4-0000-4000-8000-000000000002",
				name: "opalinehq/cli",
				sessionCount: 96,
				enabled: true,
				sources: ["claude_code"],
			},
			{
				id: "a1b2c3d4-0000-4000-8000-000000000003",
				name: "evrendom/portfolio",
				sessionCount: 31,
				enabled: false,
				sources: ["codex"],
			},
		],
		organizationId: signedInSetup ? USER_ID : null,
		totals:
			scenario.connection === "uploading"
				? { uploaded: 214, skipped: 4, failed: 0 }
				: null,
		failureReason:
			scenario.connection === "failed" ? "connection_failed" : null,
	};
}

function sendJson(response: ServerResponse, body: unknown, status = 200) {
	response.statusCode = status;
	response.setHeader("content-type", "application/json");
	response.end(JSON.stringify(body));
}

function sendEvents(
	request: IncomingMessage,
	response: ServerResponse,
	first?: unknown,
) {
	// Held open like the real stream, so the page never reads a closed stream
	// as a dropped connection.
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
	});
	response.write(
		first
			? `retry: 600000\nevent: connection\ndata: ${JSON.stringify(first)}\n\n`
			: "retry: 600000\n\n",
	);
	const heartbeat = setInterval(
		() => response.write(": keepalive\n\n"),
		15_000,
	);
	request.on("close", () => clearInterval(heartbeat));
}

/** Answers every API call the welcome page makes; false for anything else. */
export function handleOnboardingRequest(
	request: IncomingMessage,
	response: ServerResponse,
): boolean {
	const url = new URL(request.url ?? "/", "http://localhost");
	const path = url.pathname;
	if (path === ONBOARDING_DEV_PATH || path === `${ONBOARDING_DEV_PATH}/`) {
		// Start from the first state; the picker takes it from there.
		response.statusCode = 302;
		response.setHeader(
			"set-cookie",
			`${ONBOARDING_SCENARIO_COOKIE}=ready; Path=/; SameSite=Lax`,
		);
		response.setHeader("location", "/welcome");
		response.end();
		return true;
	}
	if (!/^\/(?:api|rpc)\//u.test(path)) return false;
	const scenario = readScenario(request);
	const now = new Date().toISOString();
	const user = {
		id: USER_ID,
		name: "Evren Dombak",
		email: "evren@opaline.so",
		emailVerified: true,
		image: null,
		jobTitle: null,
		createdAt: now,
		updatedAt: now,
	};
	const connection = path.match(
		/^\/api\/cli\/connections(?:\/([0-9a-f-]{36}))?(\/events)?$/u,
	);

	if (path === "/api/auth/get-session") {
		sendJson(
			response,
			scenario.signedIn
				? {
						session: {
							id: "session-onboarding-dev",
							userId: USER_ID,
							token: "onboarding-dev",
							expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
							createdAt: now,
							updatedAt: now,
							activeOrganizationId: USER_ID,
						},
						user,
					}
				: null,
		);
	} else if (path === "/api/auth/organization/list") {
		sendJson(response, scenario.signedIn ? [workspace] : []);
	} else if (path === "/api/auth/organization/get-full-organization") {
		sendJson(
			response,
			scenario.signedIn
				? {
						...workspace,
						members: [
							{
								id: "member-onboarding-dev",
								organizationId: USER_ID,
								userId: USER_ID,
								role: "owner",
								createdAt: now,
								user: {
									id: USER_ID,
									name: user.name,
									email: user.email,
									image: null,
								},
							},
						],
						invitations: [],
					}
				: null,
		);
	} else if (path === "/api/auth/organization/get-active-member") {
		sendJson(
			response,
			scenario.signedIn
				? {
						id: "member-onboarding-dev",
						organizationId: USER_ID,
						userId: USER_ID,
						role: "owner",
					}
				: null,
		);
	} else if (path === "/api/auth/organization/check-slug") {
		sendJson(response, { status: true });
	} else if (path.startsWith("/api/auth/organization/")) {
		sendJson(response, workspace);
	} else if (path.startsWith("/api/auth/")) {
		sendJson(response, { status: true, user });
	} else if (connection?.[2]) {
		sendEvents(request, response, snapshot(scenario, connection[1]));
	} else if (connection && request.method === "POST" && !connection[1]) {
		sendJson(response, {
			connection: snapshot(scenario),
			// The real format: 43 URL-safe characters.
			code: "onboarding-dev-pairing-code-000000000000000",
			codeExpiresAt: new Date(Date.now() + 600_000).toISOString(),
		});
	} else if (connection) {
		sendJson(response, snapshot(scenario, connection[1] ?? CONNECTION_ID));
	} else if (path.endsWith("/events")) {
		sendEvents(request, response);
	} else if (path.startsWith("/rpc/githubRepositoryEvidence/status")) {
		sendJson(response, {
			json: {
				visibility: "visible",
				dashboard: "notConnected",
				connection: {
					accountLogin: null,
					accountType: null,
					canManage: true,
					configurationError: null,
					configured: true,
					connected: false,
					installationId: null,
					manageUrl: null,
					repositories: [],
					repositorySelection: null,
				},
			},
		});
	} else {
		// The welcome page needs nothing else; the dashboard behind "Done"
		// shows its error states instead of reaching a real API.
		sendJson(
			response,
			{
				json: {
					defined: false,
					code: "SERVICE_UNAVAILABLE",
					status: 503,
					message: "Not part of the onboarding dev mode.",
				},
			},
			503,
		);
	}
	return true;
}

/** The floating state picker, injected into the page by the dev config. */
export function onboardingPickerScript() {
	const scenarios = Object.fromEntries(
		Object.entries(ONBOARDING_SCENARIOS).map(([id, scenario]) => [
			id,
			{
				label: scenario.label,
				group: scenario.group,
				search: scenario.search,
				step: "step" in scenario ? scenario.step : null,
			},
		]),
	);
	return `(() => {
	const scenarios = ${JSON.stringify(scenarios)};
	const cookie = "${ONBOARDING_SCENARIO_COOKIE}";
	const progressKey = "opaline.welcome.${CONNECTION_ID}.${USER_ID}";
	const current = document.cookie.match(new RegExp("(?:^|;\\\\s*)" + cookie + "=([^;]+)"))?.[1] ?? "ready";
	const open = (id) => {
		const scenario = scenarios[id];
		document.cookie = cookie + "=" + id + "; path=/; SameSite=Lax";
		try {
			for (const key of Object.keys(localStorage))
				if (key.startsWith("opaline.welcome.") || key.startsWith("opaline.cli")) localStorage.removeItem(key);
			if (scenario.step)
				localStorage.setItem(progressKey, JSON.stringify({ step: scenario.step, organizationId: scenario.step === "workspace" ? null : "${USER_ID}", github: "pending" }));
		} catch {}
		location.href = "/welcome" + scenario.search;
	};
	const setTheme = (theme) => {
		try {
			if (theme === "system") localStorage.removeItem("theme");
			else localStorage.setItem("theme", theme);
		} catch {}
		location.reload();
	};
	const savedTheme = (() => { try { return localStorage.getItem("theme") ?? "system"; } catch { return "system"; } })();
	const panel = document.createElement("div");
	panel.setAttribute("data-onboarding-dev-picker", "");
	panel.style.cssText = "position:fixed;z-index:2147483647;right:12px;bottom:64px;width:220px;padding:10px;border-radius:12px;font:12px/1.3 system-ui,sans-serif;background:Canvas;color:CanvasText;box-shadow:0 0 0 1px color-mix(in srgb,CanvasText 12%,transparent),0 8px 24px rgb(0 0 0/.18)";
	const body = document.createElement("div");
	const title = document.createElement("button");
	title.type = "button";
	title.textContent = "Onboarding dev";
	title.style.cssText = "display:block;width:100%;padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:600;text-align:left;cursor:pointer";
	const collapsedKey = "opaline.onboarding-dev.collapsed";
	const applyCollapsed = (collapsed) => {
		body.hidden = collapsed;
		title.setAttribute("aria-expanded", String(!collapsed));
	};
	applyCollapsed(sessionStorage.getItem(collapsedKey) === "1");
	title.addEventListener("click", () => {
		const collapsed = !body.hidden;
		sessionStorage.setItem(collapsedKey, collapsed ? "1" : "0");
		applyCollapsed(collapsed);
	});
	panel.append(title, body);
	const section = (name, items, isActive, onPick) => {
		const label = document.createElement("div");
		label.textContent = name;
		label.style.cssText = "opacity:.55;margin:8px 0 4px";
		const row = document.createElement("div");
		row.style.cssText = "display:flex;flex-wrap:wrap;gap:4px";
		const buttons = items.map(([value, text]) => {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = text;
			button.dataset.value = value;
			button.addEventListener("click", () => onPick(value));
			row.append(button);
			return button;
		});
		const paint = () => {
			for (const button of buttons) {
				const active = isActive(button.dataset.value);
				button.setAttribute("aria-pressed", String(active));
				button.style.cssText = "padding:3px 7px;border-radius:6px;border:0;cursor:pointer;font:inherit;color:inherit;background:" + (active ? "color-mix(in srgb,CanvasText 16%,transparent)" : "color-mix(in srgb,CanvasText 6%,transparent)");
			}
		};
		paint();
		body.append(label, row);
		return paint;
	};
	for (const group of ["Terminal", "Sign in", "Setup"])
		section(group, Object.entries(scenarios).filter(([, s]) => s.group === group).map(([id, s]) => [id, s.label]), (id) => id === current, open);
	section("Theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], (theme) => theme === savedTheme, setTheme);
	// Hide the gradient backdrop behind the window, to compare the page with
	// and without it. Kept across reloads; no reload needed.
	const backdropKey = "opaline.onboarding-dev.backdrop";
	const hideBackdrop = document.createElement("style");
	hideBackdrop.textContent = ".product-window-backdrop{display:none!important}";
	let backdrop = (() => { try { return localStorage.getItem(backdropKey) ?? "on"; } catch { return "on"; } })();
	const applyBackdrop = () => {
		if (backdrop === "off") document.head.append(hideBackdrop);
		else hideBackdrop.remove();
	};
	applyBackdrop();
	const paintBackdrop = section("Backdrop", [["on", "On"], ["off", "Off"]], (value) => value === backdrop, (value) => {
		backdrop = value;
		try { localStorage.setItem(backdropKey, value); } catch {}
		applyBackdrop();
		paintBackdrop();
	});
	document.body.append(panel);
})();`;
}
