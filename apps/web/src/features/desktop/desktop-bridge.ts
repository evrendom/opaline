import { useSyncExternalStore } from "react";

export type DesktopRepository = {
	key: string;
	name: string;
	paths: string[];
	sources: string[];
	sessionCount: number;
	uploadedCount: number | null;
	enabled: boolean;
	current: boolean;
	problem: string | null;
};

export type DesktopRepositoryList = {
	signedIn: boolean;
	repositories: DesktopRepository[];
};

export type DesktopApplyEvent =
	| {
			type: "progress";
			phase: "scan" | "authorize" | "save" | "upload";
			completed?: number;
			total?: number;
	  }
	| { type: "authorize"; url: string }
	| {
			type: "done";
			uploaded: number;
			failed: number;
			skipped: number;
			changes: number;
	  }
	| {
			type: "error";
			code?: string;
			message: string;
			organizations?: { id: string; name: string }[];
	  };

export type DesktopApplyOptions = {
	code?: string;
	enable: string[];
	disable: string[];
	organization?: string;
};

type DesktopBridge = {
	listRepositories: () => Promise<DesktopRepositoryList>;
	applyRepositories: (
		options: DesktopApplyOptions,
		onEvent: (event: DesktopApplyEvent) => void,
	) => Promise<DesktopApplyEvent | undefined>;
};

declare global {
	interface Window {
		opalineDesktop?: DesktopBridge;
	}
}

const subscribe = () => () => {};

export function useDesktop(): DesktopBridge | null {
	return useSyncExternalStore(
		subscribe,
		() => window.opalineDesktop ?? null,
		() => null,
	);
}
