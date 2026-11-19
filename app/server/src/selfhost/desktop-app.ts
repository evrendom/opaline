import { execFile } from "node:child_process";
import { getLogger } from "@logtape/logtape";
import { getFrontendOrigin } from "../frontend-origin.js";
import { isSelfHosted } from "../lib/self-hosted.js";

type Environment = Readonly<Record<string, string | undefined>>;

const SETTLE_MS = 750;
const REPEAT_MS = 30_000;

const logger = getLogger(["rudel", "api", "selfhost", "desktop-app"]);

export function hasDesktopApp(env: Environment = process.env): boolean {
	return isSelfHosted(env) && env.OPALINE_DESKTOP_APP === "1";
}

export function desktopAppLink(pageUrl: string, origin: string): string | null {
	if (/^opaline:/iu.test(pageUrl)) return pageUrl;
	let page: URL;
	let own: URL;
	try {
		page = new URL(pageUrl);
		own = new URL(origin);
	} catch {
		return null;
	}
	if (page.origin !== own.origin) return null;
	return `opaline://${page.pathname.replace(/^\/+/u, "")}${page.search}${page.hash}`;
}

function openWithMacOS(link: string): void {
	execFile("/usr/bin/open", [link], { timeout: 10_000 }, (error) => {
		if (error)
			logger.warn("Could not open {link} in the desktop app: {error}", {
				link,
				error: error.message,
			});
	});
}

export interface DesktopOpenerOptions {
	readonly env?: Environment;
	readonly platform?: NodeJS.Platform;
	readonly origin?: () => string;
	readonly open?: (link: string) => void;
	readonly now?: () => number;
	readonly settleMs?: number;
	readonly repeatMs?: number;
}

export function createDesktopOpener(options: DesktopOpenerOptions = {}) {
	const open = options.open ?? openWithMacOS;
	const now = options.now ?? Date.now;
	const origin = options.origin ?? getFrontendOrigin;
	const settleMs = options.settleMs ?? SETTLE_MS;
	const repeatMs = options.repeatMs ?? REPEAT_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let queued: string | undefined;
	let last: { link: string; at: number } | undefined;

	function flush() {
		timer = undefined;
		const link = queued;
		queued = undefined;
		if (!link) return;
		const at = now();
		if (last?.link === link && at - last.at < repeatMs) return;
		last = { link, at };
		open(link);
	}

	return {
		show(pageUrl: string): boolean {
			if (!hasDesktopApp(options.env ?? process.env)) return false;
			if ((options.platform ?? process.platform) !== "darwin") return false;
			const link = desktopAppLink(pageUrl, origin());
			if (!link) return false;
			queued = link;
			if (timer) clearTimeout(timer);
			timer = setTimeout(flush, settleMs);
			timer.unref?.();
			return true;
		},
	};
}

export const desktopApp = createDesktopOpener();
