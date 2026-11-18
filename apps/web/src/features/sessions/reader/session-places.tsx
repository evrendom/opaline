import { createContext, useCallback, useContext, useMemo } from "react";
import { useSessionFileChanges } from "../use-session-file-changes";

export type SessionPlaces = {
	openCi: (picks: { ci?: string; pr?: string }) => void;
	openFile: (picks: { file?: string; run?: string }) => void;
	openSetup: (setupFile?: string) => void;
	openSubagent: (subagentId?: string) => void;
	hrefs: {
		ci: (picks: { ci?: string; pr?: string }) => string;
		file: (picks: { file?: string; run?: string }) => string;
		setup: (setupFile?: string) => string;
		subagent: (subagentId?: string) => string;
	};
	skillSetupFile: (name: string) => string | null;
	mcpSetupFile: (server: string) => string | null;
	pullRequestOf: (number: number) => string | null;
	sessionId: string;
	revision: string;
};

export const SessionPlacesContext = createContext<SessionPlaces | null>(null);

export function useSessionPlaces(): SessionPlaces | null {
	return useContext(SessionPlacesContext);
}

export function useSessionFileOf(): (path: string) => string | null {
	const places = useSessionPlaces();
	const query = useSessionFileChanges(
		places?.sessionId ?? "",
		places?.revision ?? "",
	);
	const paths = useMemo(
		() => query.data?.files.map((file) => file.path) ?? null,
		[query.data],
	);
	return useCallback(
		(path: string) =>
			paths ? resolveSessionFile(paths, path, { absolute: "known" }) : null,
		[paths],
	);
}

export function pullRequestKey(repository: string, number: number): string {
	return `${repository}#${number}`;
}

export function resolveSessionFile(
	paths: readonly string[],
	path: string,
	{
		absolute = "as-is",
	}: {
		absolute?: "as-is" | "known";
	} = {},
): string | null {
	const trimmed = path.trim().replace(/^\.\//, "");
	if (!trimmed) return null;
	if (paths.includes(trimmed)) return trimmed;
	if (trimmed.startsWith("/") || trimmed.startsWith("~/"))
		return absolute === "as-is" ? trimmed : null;
	const ending = paths.filter((each) => each.endsWith(`/${trimmed}`));
	return ending.length === 1 ? (ending[0] ?? null) : null;
}

export function findMcpSetupFile(
	setup: readonly { kind: string; owner: string; setupFile: string }[],
	server: string,
): string | null {
	const wanted = server.toLowerCase();
	const names = (owner: string) =>
		[
			owner,
			owner.replace(/^plugin:/u, ""),
			owner.split(":").at(-1) ?? owner,
			owner.replace(/^claude\.ai /u, ""),
		].map((name) => name.toLowerCase());
	return (
		setup.find(
			(file) =>
				file.kind === "mcp_instructions" && names(file.owner).includes(wanted),
		)?.setupFile ?? null
	);
}
