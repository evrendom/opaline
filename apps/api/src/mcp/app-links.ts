import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import { getFrontendOrigin } from "../frontend-origin.js";
import { isSelfHosted } from "../lib/self-hosted.js";
import { hasDesktopApp } from "../selfhost/desktop-app.js";
import { isRecordUuid } from "../services/analysis/record-uuid.js";

export const APP_ROUTES = {
	sessions: "/:workspaceSlug/sessions",
	session: "/:workspaceSlug/sessions/:sessionId",
	dashboard: "/:workspaceSlug/dashboard",
	report: "/:workspaceSlug/reports/:analysisId",
} as const;

export type AppRoute = keyof typeof APP_ROUTES;

export const DATE_RANGE_PARAMS = { from: "from", to: "to" } as const;

type Query = Record<string, string | number | null | undefined>;

export function routeParams(route: AppRoute): string[] {
	return [...APP_ROUTES[route].matchAll(/:([A-Za-z]+)/gu)].map(
		(match) => match[1] ?? "",
	);
}

export function appUrl(
	route: AppRoute,
	params: Record<string, string>,
	query: Query = {},
): string {
	const expected = routeParams(route);
	const missing = expected.filter((name) => !params[name]);
	const unexpected = Object.keys(params).filter(
		(name) => !expected.includes(name),
	);
	if (missing.length || unexpected.length)
		throw new Error(
			[
				missing.length ? `missing: ${missing.join(", ")}` : "",
				unexpected.length ? `unexpected: ${unexpected.join(", ")}` : "",
			]
				.filter(Boolean)
				.join("; "),
		);
	const path = APP_ROUTES[route].replace(/:([A-Za-z]+)/gu, (_, name: string) =>
		encodeURIComponent(params[name] ?? ""),
	);
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(query))
		if (value !== undefined && value !== null && `${value}` !== "")
			search.set(key, `${value}`);
	const suffix = search.toString();
	return pageLink(`${path}${suffix ? `?${suffix}` : ""}`);
}

export function workspacePageUrl(workspaceSlug: string, path: string): string {
	return pageLink(`/${encodeURIComponent(workspaceSlug)}${path}`);
}

const DESKTOP_LINK = /^opaline:(?:\/\/)?(.*)$/isu;
const SESSION_RESOURCE_LINK = /^sessions\/([^/?#]+)\/([^/?#]+)(.*)$/su;

export function pageLink(path: string): string {
	return hasDesktopApp()
		? `opaline://${path.replace(/^\/+/u, "")}`
		: `${getFrontendOrigin()}${path}`;
}

export function linkExample(): string {
	if (hasDesktopApp()) return "opaline://…";
	return isSelfHosted() ? `${getFrontendOrigin()}/…` : "https://opaline.so/…";
}

function desktopLinkPage(raw: string, origin: string): URL | null {
	const rest = (DESKTOP_LINK.exec(raw.replace(/[\t\n\r]/gu, ""))?.[1] ?? "")
		.replace(/^[/\\]+/u, "")
		.replace(SESSION_RESOURCE_LINK, "$1/sessions/$2$3");
	try {
		const page = new URL(`/${rest}`, origin);
		return page.origin === origin ? page : null;
	} catch {
		return null;
	}
}

export function sessionUrl(workspace: string, sessionId: string): string {
	return appUrl("session", { workspaceSlug: workspace, sessionId });
}

export function sessionsUrl(
	workspace: string,
	range: { from?: string | null; to?: string | null } = {},
): string {
	const day = (value: string | null | undefined) =>
		value && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : null;
	const from = day(range.from);
	const to = day(range.to);
	return appUrl(
		"sessions",
		{ workspaceSlug: workspace },
		from && to
			? { [DATE_RANGE_PARAMS.from]: from, [DATE_RANGE_PARAMS.to]: to }
			: {},
	);
}

export function withUrlLine(text: string, url: string): string {
	return `url: ${url}\n${text}`;
}

export type PastedUrl =
	| {
			readonly kind: "session";
			readonly workspace: string | null;
			readonly sessionId: string;
			readonly record: string | null;
			readonly from: string | null;
			readonly to: string | null;
	  }
	| {
			readonly kind: "dashboard";
			readonly workspace: string | null;
			readonly args: Record<string, string | string[]>;
	  }
	| {
			readonly kind: "sessions";
			readonly workspace: string | null;
			readonly from: string | null;
			readonly to: string | null;
	  }
	| { readonly kind: "other"; readonly path: string };

const OPALINE_HOST = /(^|\.)opaline\.so$/u;
const DASHBOARD_PARAMS: Record<string, string> = {
	from: "startDate",
	to: "endDate",
	metric: "metric",
	split: "splitBy",
};
const DASHBOARD_LISTS: Record<string, string> = {
	repo: "repositories",
	model: "models",
};

export function classifyOpalineUrl(raw: string): PastedUrl | null {
	const ownOrigin = (() => {
		try {
			return new URL(getFrontendOrigin()).origin;
		} catch {
			return "";
		}
	})();
	let url: URL;
	if (hasDesktopApp() && /^opaline:/iu.test(raw.trim())) {
		const page = ownOrigin ? desktopLinkPage(raw.trim(), ownOrigin) : null;
		if (!page) return null;
		url = page;
	} else
		try {
			url = new URL(raw.trim());
		} catch {
			return null;
		}
	if (!OPALINE_HOST.test(url.hostname) && url.origin !== ownOrigin) return null;
	const segments = url.pathname
		.split("/")
		.filter(Boolean)
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		});
	const [first = ""] = segments;
	const workspace = validateOrgSlug(first) ? first : null;
	const rest = workspace ? segments.slice(1) : segments;
	const params = url.searchParams;
	const from = params.get(DATE_RANGE_PARAMS.from);
	const to = params.get(DATE_RANGE_PARAMS.to);
	const [section = "", second] = rest;
	const reader =
		section === "sessions" || section === "session" || section === "newsesh"
			? rest.slice(1)
			: section === "dashboard" && second === "sessions"
				? rest.slice(2)
				: [];
	const [head, tail] = reader;
	const sessionId = head === "full" || head === "split" ? tail : head;
	if (sessionId) {
		const turn = params.get("turn") ?? params.get("run");
		return {
			kind: "session",
			workspace,
			sessionId,
			record: turn && isRecordUuid(turn) ? turn : null,
			from,
			to,
		};
	}
	if ((section === "sessions" || section === "session") && second === undefined)
		return { kind: "sessions", workspace, from, to };
	if (section === "dashboard" || (workspace && section === "")) {
		const args: Record<string, string | string[]> = {};
		for (const [param, arg] of Object.entries(DASHBOARD_PARAMS)) {
			const value = params.get(param);
			if (value) args[arg] = value;
		}
		for (const [param, arg] of Object.entries(DASHBOARD_LISTS)) {
			const values = params.getAll(param).filter(Boolean);
			if (values.length) args[arg] = values;
		}
		return { kind: "dashboard", workspace, args };
	}
	return { kind: "other", path: url.pathname };
}

export function pastedUrlHint(pasted: PastedUrl): string {
	if (pasted.kind === "session") {
		const literal = pasted.sessionId
			.replaceAll("\\", "\\\\")
			.replaceAll("'", "\\'");
		const dates = {
			...(pasted.from ? { from: pasted.from } : {}),
			...(pasted.to ? { to: pasted.to } : {}),
		};
		return [
			`This link opens session ${pasted.sessionId} without a run (no ?turn=).`,
			`List its runs with sql ${JSON.stringify({ title: "Runs of one session", query: `SELECT run_id, agent_id, turn_idx, started_at FROM runs WHERE session_id = '${literal}' ORDER BY agent_id, turn_idx` })} and open one with run id=<run_id>,`,
			`or survey them with find ${JSON.stringify({ source: "runs", sessionId: pasted.sessionId, ...dates })}.`,
		].join("\n");
	}
	if (pasted.kind === "dashboard")
		return `This is the Opaline dashboard, not a run: call get_dashboard with ${JSON.stringify(pasted.args)}.`;
	if (pasted.kind === "sessions")
		return `This is the session list, not a run: call find with ${JSON.stringify({ source: "runs", ...(pasted.from ? { from: pasted.from } : {}), ...(pasted.to ? { to: pasted.to } : {}) })}.`;
	return `This Opaline link (${pasted.path}) is not a session or dashboard link: run opens a run_id from sql, or a session link with ?turn=; saved answers open with answers action=open and their id.`;
}
