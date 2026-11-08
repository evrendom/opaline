import { createContext, useContext } from "react";
import { z } from "zod";
import { getApiBaseUrl } from "@/lib/api-base-url";

export const SELF_HOST_INFO_PATH = "/api/selfhost/info";
const INFO_TIMEOUT_MS = 5_000;
const CLOUD_ORIGINS = new Set(["https://opaline.so", "https://www.opaline.so"]);
const MODES_WITHOUT_SERVER = new Set(["plugin", "product-demo"]);

const SelfHostAuthSchema = z.object({
	password: z.boolean().catch(true),
	emailCodes: z.boolean().catch(false),
	social: z.array(z.string()).catch([]),
});

const SelfHostInfoSchema = z.object({
	selfHosted: z.literal(true),
	version: z.string().catch("dev"),
	appUrl: z.string().catch(""),
	mcpUrl: z.string().catch(""),
	setupComplete: z.boolean().catch(true),
	auth: SelfHostAuthSchema.catch({
		password: true,
		emailCodes: false,
		social: [],
	}),
});

export type SelfHostInfo = z.infer<typeof SelfHostInfoSchema>;

export function parseSelfHostInfo(value: unknown): SelfHostInfo | null {
	const parsed = SelfHostInfoSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function asksServerForSelfHostInfo(origin: string, mode: string) {
	return !MODES_WITHOUT_SERVER.has(mode) && !CLOUD_ORIGINS.has(origin);
}

type FetchInfo = (url: URL, init: RequestInit) => Promise<Response>;

export async function fetchSelfHostInfo(
	fetchImpl: FetchInfo = (url, init) => fetch(url, init),
	apiBaseUrl: string = getApiBaseUrl(),
): Promise<SelfHostInfo | null> {
	try {
		const response = await fetchImpl(new URL(SELF_HOST_INFO_PATH, apiBaseUrl), {
			credentials: "omit",
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		return parseSelfHostInfo(await response.json());
	} catch {
		return null;
	}
}

let known: SelfHostInfo | null = null;
let loading: Promise<SelfHostInfo | null> | null = null;

export function getSelfHostInfo(): SelfHostInfo | null {
	return known;
}

export function loadSelfHostInfo(
	fetchInfo: () => Promise<SelfHostInfo | null> = fetchSelfHostInfo,
): Promise<SelfHostInfo | null> {
	loading ??= fetchInfo().then((info) => {
		known = info;
		return info;
	});
	return loading;
}

export function whenSelfHostInfoKnown(
	onKnown: (info: SelfHostInfo | null) => void,
	origin: string = window.location.origin,
	mode: string = import.meta.env.MODE,
) {
	if (!asksServerForSelfHostInfo(origin, mode)) {
		onKnown(null);
		return;
	}
	void loadSelfHostInfo().then(onKnown);
}

export const SelfHostContext = createContext<SelfHostInfo | null>(null);

export function useSelfHost(): SelfHostInfo | null {
	return useContext(SelfHostContext);
}
