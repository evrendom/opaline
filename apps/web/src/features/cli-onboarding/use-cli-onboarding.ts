import { useCallback, useEffect, useRef, useState } from "react";
import { appRoutes } from "@/app/routes";
import { authClient } from "@/lib/auth-client";
import {
	CLI_CONNECTION_PATH,
	CliConnectionCreateResponseSchema,
	CliConnectionIdSchema,
	type CliConnectionSnapshot,
	CliConnectionSnapshotSchema,
	isCliConnectionTerminal,
} from "../../../../../packages/api-routes/src/cli-connection";
import {
	CLI_AUTHORIZATION_STORAGE_KEY,
	type CliAuthorization,
	readCliAuthorization,
	readCliConnectionId,
	readStoredCliAuthorization,
} from "./cli-authorization";

import { copyCliCommand, type PreparedCliCommand } from "./copy-cli-command";

const STORAGE_KEY = "opaline.cli-connection";
const SETUP_COMMAND = "npx opaline@latest";
const CONNECTION_ACTIVITY_TIMEOUT_MS = 90_000;
const FRESH_SETUP_PARAM = "fresh";

function requestsFreshSetup(search: string): boolean {
	return new URLSearchParams(search).get(FRESH_SETUP_PARAM) === "1";
}

function readLocalCommand(): string | null {
	if (
		typeof window === "undefined" ||
		!["localhost", "127.0.0.1"].includes(window.location.hostname)
	)
		return null;
	const value = document.querySelector<HTMLMetaElement>(
		'meta[name="opaline-local-cli"]',
	)?.content;
	return value || null;
}

export function useCliOnboarding(
	active: boolean,
	options: {
		mode: "demo" | "setup";
		autoOpenDashboard?: boolean;
		onOpenDashboard?: (organizationId: string, path: string) => Promise<void>;
	},
) {
	const { mode, onOpenDashboard, autoOpenDashboard = true } = options;
	const freshSetup =
		mode === "setup" &&
		typeof window !== "undefined" &&
		requestsFreshSetup(window.location.search);
	const [localCommand, setLocalCommand] = useState<string | null>(null);
	useEffect(() => setLocalCommand(readLocalCommand()), []);
	const [id, setId] = useState<string | null>(null);
	const [authorization, setAuthorization] = useState<CliAuthorization | null>(
		null,
	);
	const [snapshot, setSnapshot] = useState<CliConnectionSnapshot | null>(null);
	const personalView =
		mode === "setup" ||
		Boolean(snapshot?.repositories.some((repository) => repository.enabled));
	const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [streamError, setStreamError] = useState<string | null>(null);
	const [staleConnectionRevision, setStaleConnectionRevision] = useState<
		string | null
	>(null);
	const [opening, setOpening] = useState(false);
	const creation = useRef<Promise<{ code: string } | null> | null>(null);
	const openedConnection = useRef<string | null>(null);
	const receiveSnapshot = useCallback((next: CliConnectionSnapshot) => {
		setSnapshot(next);
		setStreamError(null);
		if (next.state !== "waiting") setCode(null);
	}, []);
	useEffect(() => {
		// Only a setup route restores a previous connection. A demo visit stays
		// a demo until this tab hands a fresh command to the terminal.
		if (mode !== "setup") return;
		if (freshSetup) return;
		const fromUrl = readCliAuthorization(window.location.search);
		if (fromUrl) {
			setAuthorization(fromUrl);
			setId(fromUrl.id);
			return;
		}
		const params = new URLSearchParams(window.location.search);
		const urlId = readCliConnectionId(window.location.search);
		if (params.has("connect") && (!urlId || params.has("user_code"))) {
			setError(
				"This login link is invalid. Prepare a new command to continue.",
			);
			return;
		}
		if (urlId) {
			setId(urlId);
		}
		try {
			const savedId = urlId ?? localStorage.getItem(STORAGE_KEY);
			const savedAuthorization = readStoredCliAuthorization(
				localStorage.getItem(CLI_AUTHORIZATION_STORAGE_KEY),
			);
			if (savedAuthorization?.id === savedId)
				setAuthorization(savedAuthorization);
		} catch {
			/* Optional resume storage. */
		}
	}, [mode, freshSetup]);
	useEffect(() => {
		// Only share the login link after the API confirms this browser owns it.
		if (!authorization || snapshot?.id !== authorization.id) return;
		try {
			const value = JSON.stringify(authorization);
			if (localStorage.getItem(CLI_AUTHORIZATION_STORAGE_KEY) !== value)
				localStorage.setItem(CLI_AUTHORIZATION_STORAGE_KEY, value);
			localStorage.setItem(STORAGE_KEY, authorization.id);
		} catch {
			/* The opened tab still works without storage. */
		}
	}, [authorization, snapshot?.id]);
	const create = useCallback(() => {
		if (creation.current) return creation.current;
		setError(null);
		creation.current = (async () => {
			const response = await fetch(CLI_CONNECTION_PATH, {
				method: "POST",
				credentials: "include",
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) throw new Error("Could not create a connection code.");
			const result = CliConnectionCreateResponseSchema.parse(
				await response.json(),
			);
			setError(null);
			setStreamError(null);
			setCode(null);
			setAuthorization(null);
			const url = new URL(window.location.href);
			url.searchParams.delete("connect");
			url.searchParams.delete("user_code");
			url.searchParams.delete(FRESH_SETUP_PARAM);
			window.history.replaceState(window.history.state, "", url);
			try {
				localStorage.setItem(STORAGE_KEY, result.connection.id);
			} catch {
				/* The current tab still works without storage. */
			}
			setSnapshot(result.connection);
			setId(result.connection.id);
			setCode({
				value: result.code,
				expiresAt: Date.parse(result.codeExpiresAt),
			});
			return { code: result.code };
		})()
			.catch(() => {
				setError(
					"Could not create your connection code. Check your connection and try again.",
				);
				return null;
			})
			.finally(() => {
				creation.current = null;
			});
		return creation.current;
	}, []);

	useEffect(() => {
		// Demo commands are prepared on Copy, so reloads neither resume old
		// uploads nor consume another one-time pairing code.
		if (mode !== "setup" || !active || id) return;
		if (new URLSearchParams(window.location.search).has("connect")) return;
		if (freshSetup) {
			void create();
			return;
		}
		let saved: string | null = null;
		try {
			saved = localStorage.getItem(STORAGE_KEY);
		} catch {
			/* Optional resume storage. */
		}
		if (CliConnectionIdSchema.safeParse(saved).success) setId(saved);
		else void create();
	}, [mode, active, id, create, freshSetup]);

	useEffect(() => {
		function changed(event: StorageEvent) {
			if (event.key === CLI_AUTHORIZATION_STORAGE_KEY) {
				const next = readStoredCliAuthorization(event.newValue);
				if (next?.id === id) setAuthorization(next);
			}
			if (
				mode === "setup" &&
				!freshSetup &&
				event.key === STORAGE_KEY &&
				event.newValue !== id &&
				!new URLSearchParams(window.location.search).has("connect") &&
				CliConnectionIdSchema.safeParse(event.newValue).success
			) {
				setCode(null);
				setSnapshot(null);
				setId(event.newValue);
			}
		}
		window.addEventListener("storage", changed);
		return () => window.removeEventListener("storage", changed);
	}, [mode, id, freshSetup]);

	useEffect(() => {
		if (!active || !id) return;
		const abort = new AbortController();
		let events: EventSource | undefined;
		void (async () => {
			const response = await fetch(`${CLI_CONNECTION_PATH}/${id}`, {
				credentials: "include",
				signal: abort.signal,
			});
			if (abort.signal.aborted) return;
			if (response.status === 404) {
				if (
					mode === "setup" &&
					new URLSearchParams(window.location.search).has("connect")
				)
					throw new Error(
						"Open the login link in the browser where you copied the command, or copy a new command.",
					);
				await create();
				return;
			}
			if (!response.ok) throw new Error("Could not read the connection.");
			const current = CliConnectionSnapshotSchema.parse(await response.json());
			if (abort.signal.aborted) return;
			receiveSnapshot(current);
			setError(null);
			if (isCliConnectionTerminal(current.state)) return;
			events = new EventSource(`${CLI_CONNECTION_PATH}/${id}/events`, {
				withCredentials: true,
			});
			events.addEventListener("connection", (event) => {
				let payload: unknown;
				try {
					payload = JSON.parse(event.data);
				} catch {
					return;
				}
				const parsed = CliConnectionSnapshotSchema.safeParse(payload);
				if (!parsed.success || parsed.data.id !== id) return;
				receiveSnapshot(parsed.data);
				setError(null);
				if (isCliConnectionTerminal(parsed.data.state)) events?.close();
			});
			events.onerror = () => setStreamError("Reconnecting to upload updates…");
		})().catch((error: unknown) => {
			if (!abort.signal.aborted)
				setError(
					error instanceof Error
						? error.message
						: "Could not connect. Please try again.",
				);
		});
		return () => {
			abort.abort();
			events?.close();
		};
	}, [mode, active, id, create, receiveSnapshot]);

	// The CLI sends a heartbeat every 30 seconds. Stop claiming an active setup
	// after three missed updates, including when a terminal closes without cleanup.
	useEffect(() => {
		if (
			!active ||
			!snapshot ||
			!["awaiting_login", "ready", "uploading"].includes(snapshot.state)
		)
			return;
		const revision = `${snapshot.id}:${snapshot.revision}`;
		const timer = window.setTimeout(
			() => setStaleConnectionRevision(revision),
			Math.max(
				0,
				Date.parse(snapshot.lastSeenAt) +
					CONNECTION_ACTIVITY_TIMEOUT_MS -
					Date.now(),
			),
		);
		return () => window.clearTimeout(timer);
	}, [active, snapshot]);

	useEffect(() => {
		if (!active || !code || snapshot?.state !== "waiting") return;
		const timer = window.setTimeout(
			() => setCode(null),
			Math.max(0, code.expiresAt - Date.now()),
		);
		return () => window.clearTimeout(timer);
	}, [active, code, snapshot?.state]);

	const openDashboard = useCallback(async () => {
		if (!snapshot?.organizationId) return;
		setOpening(true);
		setError(null);
		try {
			const from = "1970-01-01";
			const to = new Date().toISOString().slice(0, 10);
			try {
				localStorage.setItem(
					"dateRange",
					JSON.stringify({ start: from, end: to }),
				);
			} catch {
				/* The destination carries the dates too. */
			}
			const organizations = await authClient.organization.list({
				fetchOptions: { disableSignal: true },
			});
			const organization = organizations.data?.find(
				(item) => item.id === snapshot.organizationId,
			);
			if (!organization)
				throw new Error("Could not find your workspace. Please try again.");
			const path = `${appRoutes.workspaceSessions(organization.slug)}?from=${from}&to=${to}`;
			if (onOpenDashboard) {
				await onOpenDashboard(snapshot.organizationId, path);
			} else {
				const response = await fetch("/api/auth/organization/set-active", {
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ organizationId: snapshot.organizationId }),
					signal: AbortSignal.timeout(10_000),
				});
				if (!response.ok) throw new Error("Sign in to open your dashboard.");
				window.location.assign(path);
			}
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Could not open your dashboard.",
			);
			setOpening(false);
		}
	}, [snapshot?.organizationId, onOpenDashboard]);

	useEffect(() => {
		if (
			autoOpenDashboard &&
			mode === "setup" &&
			active &&
			snapshot?.state === "completed" &&
			openedConnection.current !== snapshot.id
		) {
			openedConnection.current = snapshot.id;
			void openDashboard();
		}
	}, [
		autoOpenDashboard,
		mode,
		active,
		snapshot?.id,
		snapshot?.state,
		openDashboard,
	]);

	async function copyCommand(): Promise<boolean> {
		function command(value: string) {
			const local = ["localhost", "127.0.0.1"].includes(location.hostname);
			return `${localCommand ?? SETUP_COMMAND} --code ${value}${local ? ` --api-base ${location.origin}` : ""}`;
		}
		const immediate: PreparedCliCommand | null =
			snapshot?.state === "waiting" &&
			code &&
			code.expiresAt > Date.now() + 30_000
				? { command: command(code.value) }
				: null;
		const prepared = immediate
			? Promise.resolve(immediate)
			: create().then((result) =>
					result ? { command: command(result.code) } : null,
				);
		// Copying does not consume a code. Keep it until the terminal redeems it
		// (reported by SSE), or it expires, so repeated copies need no new pairing.
		return copyCliCommand(prepared, immediate);
	}

	const uploadSnapshot =
		snapshot?.repositories.some((repository) => repository.enabled) &&
		(snapshot.state === "uploading" ||
			snapshot.state === "completed" ||
			snapshot.totals !== null) &&
		(snapshot.state !== "uploading" ||
			(staleConnectionRevision !== `${snapshot.id}:${snapshot.revision}` &&
				Date.parse(snapshot.lastSeenAt) + CONNECTION_ACTIVITY_TIMEOUT_MS >
					Date.now()))
			? snapshot
			: null;

	return {
		displayCommand: localCommand ? "opaline (local)" : SETUP_COMMAND,
		uploadSnapshot,
		setupSnapshot: personalView ? snapshot : null,
		setupInactive:
			snapshot !== null &&
			["awaiting_login", "ready", "uploading"].includes(snapshot.state) &&
			(staleConnectionRevision === `${snapshot.id}:${snapshot.revision}` ||
				Date.parse(snapshot.lastSeenAt) + CONNECTION_ACTIVITY_TIMEOUT_MS <=
					Date.now()),
		personalView,
		authorization: authorization?.id === id ? authorization : null,
		error: error ?? (personalView ? streamError : null),
		opening,
		ready: mode === "demo" || code !== null || id !== null,
		copyCommand,
		retry: create,
		openDashboard,
	};
}
