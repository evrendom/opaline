export interface TargetSafetyOptions {
	readonly allowRemote: boolean;
	readonly confirmTarget: string | undefined;
	readonly label: string;
	readonly rawUrl: string;
}

export function parseSafeTarget(options: TargetSafetyOptions): URL {
	let url: URL;
	try {
		url = new URL(options.rawUrl);
	} catch {
		throw new Error(`${options.label} must be a valid URL`);
	}
	if (url.username || url.password) {
		throw new Error(`${options.label} must not contain embedded credentials`);
	}
	if (url.search || url.hash) {
		throw new Error(`${options.label} must not contain a query string or hash`);
	}
	if (url.pathname !== "/") {
		throw new Error(`${options.label} must be an origin without a path`);
	}

	if (isLoopbackHostname(url.hostname)) {
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error(`${options.label} must use HTTP or HTTPS`);
		}
		return url;
	}

	if (!options.allowRemote) {
		throw new Error(
			`${options.label} is remote; pass --allow-remote and --confirm-target ${url.origin} for a deliberate manual run`,
		);
	}
	if (url.protocol !== "https:") {
		throw new Error(`${options.label} must use HTTPS for a remote target`);
	}
	if (options.confirmTarget !== url.origin) {
		throw new Error(
			`${options.label} requires --confirm-target exactly equal to ${url.origin}`,
		);
	}
	return url;
}

export function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
	if (normalized === "localhost" || normalized === "::1") return true;
	const octets = normalized.split(".");
	if (octets.length !== 4 || octets[0] !== "127") return false;
	return octets.every((octet) => {
		if (!/^\d{1,3}$/u.test(octet)) return false;
		const value = Number(octet);
		return value >= 0 && value <= 255;
	});
}
