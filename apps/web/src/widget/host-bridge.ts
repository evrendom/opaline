import type { CostDashboard, CostDashboardInput } from "@rudel/api-routes";
import type { FullOrganization } from "@/features/workspace/hooks/useFullOrganization";
import type { authClient } from "@/lib/auth-client";
import { readToolResult } from "./plugin-transport";

interface PluginBootstrap {
	session: typeof authClient.$Infer.Session;
	organization: FullOrganization;
	member?: FullOrganization["members"][number];
}

export interface PluginSeed {
	query: {
		workspace: string;
		startDate: string;
		endDate: string;
		metric: string;
		splitBy: string;
		members: string[];
		repositories: string[];
		models: string[];
	};
	dashboard: { input: CostDashboardInput; data: CostDashboard };
	bootstrap: PluginBootstrap;
}

interface ToolResult {
	structuredContent?: unknown;
	content?: Array<{ text?: string }>;
	isError?: boolean;
}

export interface WidgetState {
	route?: string;
	dateRange?: { start: string; end: string };
}

export interface HostState {
	toolOutput?: PluginSeed;
	theme?: string;
	displayMode?: string;
	deepLink?: string;
	styles?: { variables?: Record<string, string> };
}

interface HostContext extends HostState {
	"openai/deepLink"?: { url?: string } | null;
}

declare global {
	interface Window {
		openai?: Omit<HostState, "toolOutput"> & {
			toolResponseMetadata?: Record<string, PluginSeed | undefined>;
			widgetState?: WidgetState;
			setWidgetState?: (state: WidgetState) => void;
			callTool?: (name: string, args: object) => Promise<ToolResult>;
			openExternal?: (options: { href: string }) => void;
		};
	}
}

/** The `_meta` key of the tool result that carries the app's first screen. */
const WIDGET_META = "opaline/widget";
let nextId = 1;
const pending = new Map<
	number,
	{ resolve: (result: unknown) => void; reject: (error: Error) => void }
>();
const listeners = new Set<(state: HostState) => void>();
let state: HostState = {};
let widgetState: WidgetState = {};

export function requestHost(
	method: string,
	params: object,
	signal?: AbortSignal,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const id = nextId++;
		const abort = () => {
			finish();
			pending.delete(id);
			reject(signal?.reason ?? new Error("Host request timed out."));
		};
		const timeout = setTimeout(abort, 30_000);
		const finish = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		};
		pending.set(id, {
			resolve: (result) => {
				finish();
				resolve(result);
			},
			reject: (error) => {
				finish();
				reject(error);
			},
		});
		signal?.addEventListener("abort", abort, { once: true });
		window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
	});
}

export async function callTool<T = unknown>(
	name: string,
	args: object,
	signal?: AbortSignal,
): Promise<T> {
	const result = window.openai?.callTool
		? await window.openai.callTool(name, args)
		: await requestHost("tools/call", { name, arguments: args }, signal);
	return readToolResult(result) as T;
}

export function onHostState(listener: (state: HostState) => void) {
	listeners.add(listener);
	listener(state);
	return () => {
		listeners.delete(listener);
	};
}

export function getHostState() {
	return state;
}
export function getPluginWorkspace() {
	return state.toolOutput?.query.workspace ?? "";
}
export async function pluginAuthFetch(
	input: string | URL | Request,
	init?: RequestInit,
) {
	const url = new URL(
		input instanceof Request ? input.url : input,
		window.location.origin,
	);
	if (
		(
			init?.method ?? (input instanceof Request ? input.method : "GET")
		).toUpperCase() !== "GET"
	)
		return Response.json(
			{ message: "Open Opaline to make changes." },
			{ status: 403 },
		);
	const bootstrap = state.toolOutput?.bootstrap;
	if (!bootstrap) return Response.json(null, { status: 401 });
	const responses: Record<string, unknown> = {
		"get-session": bootstrap.session,
		"organization/list": [bootstrap.organization],
		"organization/get-full-organization": bootstrap.organization,
		"organization/get-active-member": bootstrap.member,
		"organization/get-active-member-role": { role: bootstrap.member?.role },
	};
	const endpoint = url.pathname.replace(/^.*\/auth\//u, "");
	return endpoint in responses
		? Response.json(responses[endpoint])
		: Response.json(
				{ message: "Not available in plugin mode." },
				{ status: 403 },
			);
}
export function getWidgetState() {
	return window.openai?.widgetState ?? widgetState;
}
export function setWidgetState(update: WidgetState) {
	widgetState = { ...getWidgetState(), ...update };
	window.openai?.setWidgetState?.(widgetState);
}

export function openPluginLink(path: string) {
	const href = `https://opaline.so${path.startsWith("/") ? path : `/${path}`}`;
	if (window.openai?.openExternal) window.openai.openExternal({ href });
	else void requestHost("ui/open-link", { url: href }).catch(console.error);
}

function publish(update: HostState) {
	if (update.styles?.variables)
		for (const name of Object.keys(state.styles?.variables ?? {})) {
			if (!(name in update.styles.variables))
				document.documentElement.style.removeProperty(name);
		}
	state = {
		...state,
		...update,
		styles: { ...state.styles, ...update.styles },
	};
	const root = document.documentElement;
	root.classList.toggle("dark", state.theme === "dark");
	const variables = Object.entries(state.styles?.variables ?? {});
	// Host weights share Tailwind's names (--font-weight-*); Opaline keeps its own.
	for (const [name, value] of variables) {
		if (name.startsWith("--") && !name.startsWith("--font-weight-"))
			root.style.setProperty(name, value);
	}
	root.toggleAttribute("data-host-styles", variables.length > 0);
	for (const listener of listeners) listener(state);
}

function fromHostContext(context: HostContext): HostState {
	const { "openai/deepLink": deepLink, ...rest } = context;
	return { ...rest, ...(deepLink?.url ? { deepLink: deepLink.url } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

if (import.meta.env.MODE === "plugin") {
	document.documentElement.dataset.appMode = "plugin";
	// An app left open across a deploy may ask for chunks that are gone; load
	// the new entry once instead of failing.
	window.addEventListener("vite:preloadError", (event) => {
		try {
			if (sessionStorage.getItem("opaline-reloaded")) return;
			sessionStorage.setItem("opaline-reloaded", "1");
		} catch {
			return; // Without a loop guard, fail visibly instead.
		}
		event.preventDefault();
		location.reload();
	});
	window.addEventListener("message", (event) => {
		const message = event.data;
		if (
			event.source !== window.parent ||
			!message ||
			typeof message !== "object"
		)
			return;
		const waiting = pending.get(message.id);
		if (waiting) {
			pending.delete(message.id);
			if (message.error) waiting.reject(new Error(message.error.message));
			else waiting.resolve(message.result);
		}
		// Only get_dashboard results carry the app's data; keep it otherwise.
		const toolOutput = message.params?._meta?.[WIDGET_META];
		if (message.method === "ui/notifications/tool-result" && toolOutput)
			publish({ toolOutput });
		if (message.method === "ui/notifications/host-context-changed")
			publish(fromHostContext(message.params));
	});
	const fromOpenAI = () => {
		const { theme, displayMode, toolResponseMetadata } = window.openai ?? {};
		const toolOutput = toolResponseMetadata?.[WIDGET_META];
		publish({ theme, displayMode, ...(toolOutput ? { toolOutput } : {}) });
	};
	window.addEventListener("openai:set_globals", fromOpenAI);
	fromOpenAI();
	void requestHost("ui/initialize", {
		protocolVersion: "2026-01-26",
		appInfo: { name: "opaline", version: "3.0.0" },
		appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
	})
		.then((result) => {
			if (isRecord(result) && isRecord(result.hostContext))
				publish(fromHostContext(result.hostContext));
			window.parent.postMessage(
				{ jsonrpc: "2.0", method: "ui/notifications/initialized" },
				"*",
			);
		})
		.catch(console.error);
	new ResizeObserver(() =>
		window.parent.postMessage(
			{
				jsonrpc: "2.0",
				method: "ui/notifications/size-changed",
				params: { height: document.documentElement.scrollHeight },
			},
			"*",
		),
	).observe(document.documentElement);
}
