const OPALINE_SCHEME = "opaline";
const LINK_PATTERN = /^opaline:(?:\/\/)?(.*)$/isu;
const SESSION_RESOURCE = /^sessions\/([^/?#]+)\/([^/?#]+)(.*)$/su;
const API_PATH = /^\/api(?:\/|$)/iu;

function isDeepLink(value) {
	return typeof value === "string" && /^opaline:/iu.test(value.trim());
}

function deepLinkFromArgv(argv) {
	return Array.isArray(argv) ? argv.find(isDeepLink) : undefined;
}

function deepLinkTarget(raw, origin) {
	if (!isDeepLink(raw) || !origin) return undefined;
	let base;
	try {
		base = new URL(origin);
	} catch {
		return undefined;
	}
	if (base.protocol !== "http:" && base.protocol !== "https:") return undefined;
	const match = LINK_PATTERN.exec(raw.trim().replace(/[\t\n\r]/gu, ""));
	let rest = (match?.[1] ?? "").replace(/^[/\\]+/u, "");
	const resource = SESSION_RESOURCE.exec(rest);
	if (resource) rest = `${resource[1]}/sessions/${resource[2]}${resource[3]}`;
	let target;
	try {
		target = new URL(`/${rest}`, base.origin);
	} catch {
		return undefined;
	}
	if (target.origin !== base.origin || API_PATH.test(target.pathname))
		return undefined;
	return target.toString();
}

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function openedUrl(raw, origin) {
	if (isDeepLink(raw)) return { kind: "link", url: raw.trim() };
	let url;
	try {
		url = new URL(raw);
	} catch {
		return { kind: "none" };
	}
	try {
		if (origin && url.origin === new URL(origin).origin)
			return { kind: "app", url: url.toString() };
	} catch {}
	return EXTERNAL_PROTOCOLS.has(url.protocol)
		? { kind: "external", url: url.toString() }
		: { kind: "none" };
}

module.exports = {
	OPALINE_SCHEME,
	deepLinkFromArgv,
	deepLinkTarget,
	isDeepLink,
	openedUrl,
};
