// Client simulation for the email lab, from caniemail.com's support data
// (MIT, https://www.caniemail.com/api/data.json, served and cached by the
// lab's dev server). For the chosen client and version, every inline CSS
// declaration the client does not support is removed before the email
// renders; partly supported ones stay and are listed with caniemail's notes.
// It approximates a client from its known rules; it is not a screenshot of
// the real thing.

export interface CanIEmailData {
	last_update_date: string;
	nicenames: {
		family: Record<string, string>;
		platform: Record<string, string>;
	};
	data: {
		slug: string;
		title: string;
		category: string;
		url: string;
		stats: Record<string, Record<string, Record<string, string>>>;
		notes_by_num: Record<string, string> | null;
	}[];
}

export interface EmailClient {
	family: string;
	platform: string;
	label: string;
	versions: string[];
}

export interface Finding {
	slug: string;
	title: string;
	url: string;
	/** Removed everywhere, removed on some elements, rewritten, or kept as partial. */
	support: "unsupported" | "unsupported-here" | "rewritten" | "partial";
	/** How many declarations or elements of the email it affects. */
	count: number;
	notes: string[];
}

/** Clients worth checking first; the rest of caniemail's list follows. */
const PREFERRED = [
	"gmail.desktop-webmail",
	"gmail.ios",
	"gmail.android",
	"apple-mail.macos",
	"apple-mail.ios",
	"outlook.windows",
	"outlook.windows-mail",
	"outlook.macos",
	"outlook.outlook-com",
	"outlook.ios",
	"outlook.android",
	"yahoo.desktop-webmail",
	"yahoo.ios",
	"samsung-email.android",
	"thunderbird.macos",
	"protonmail.desktop-webmail",
	"fastmail.desktop-webmail",
	"hey.desktop-webmail",
];

export function listClients(data: CanIEmailData): EmailClient[] {
	const versions = new Map<string, Set<string>>();
	for (const feature of data.data)
		for (const [family, platforms] of Object.entries(feature.stats))
			for (const [platform, byVersion] of Object.entries(platforms)) {
				const key = `${family}.${platform}`;
				const set = versions.get(key) ?? new Set<string>();
				for (const version of Object.keys(byVersion)) set.add(version);
				versions.set(key, set);
			}
	return [...versions]
		.map(([key, set]) => {
			const [family = "", platform = ""] = key.split(".");
			return {
				family,
				platform,
				label: `${data.nicenames.family[family] ?? family} · ${data.nicenames.platform[platform] ?? platform}`,
				versions: [...set].sort(compareVersions),
			};
		})
		.sort((a, b) => {
			const rank = (client: EmailClient) => {
				const index = PREFERRED.indexOf(`${client.family}.${client.platform}`);
				return index === -1 ? PREFERRED.length : index;
			};
			return rank(a) - rank(b) || a.label.localeCompare(b.label);
		});
}

function compareVersions(a: string, b: string): number {
	return a.localeCompare(b, "en", { numeric: true });
}

/**
 * A feature's support in the client: the stat of the chosen version, or of
 * the newest one tested at or before it. Null when caniemail never tested it.
 */
function supportOf(
	feature: CanIEmailData["data"][number],
	client: EmailClient,
	version: string,
): { level: string; notes: string[] } | null {
	const byVersion = feature.stats[client.family]?.[client.platform];
	if (!byVersion) return null;
	const tested = Object.keys(byVersion)
		.filter((candidate) => compareVersions(candidate, version) <= 0)
		.sort(compareVersions);
	const key = tested.at(-1) ?? Object.keys(byVersion).sort(compareVersions)[0];
	const value = key === undefined ? undefined : byVersion[key];
	if (!value) return null;
	const [level = "u", ...refs] = value.split(/\s+/u);
	return {
		level,
		notes: refs
			.map((ref) => feature.notes_by_num?.[ref.replace("#", "")])
			.filter((note): note is string => Boolean(note)),
	};
}

/**
 * What a partly supported declaration does on `tag`, read from caniemail's
 * notes: "Not supported on `<div>` …" and "Only supported on table cells"
 * drop it on those elements, "Replaces `height` by `min-height`" renames it.
 */
function partialEffect(
	notes: readonly string[],
	tag: string,
): { drop: true } | { rename: string } | null {
	for (const text of notes) {
		const rename = /Replaces `([a-z-]+)` by `([a-z-]+)`/iu.exec(text);
		if (rename?.[2]) return { rename: rename[2] };
		if (
			/Only supported on table cells/iu.test(text) &&
			tag !== "td" &&
			tag !== "th"
		)
			return { drop: true };
		if (/Not supported on/iu.test(text)) {
			const tags = [...text.matchAll(/`<([a-z0-9]+)>`/giu)].map((match) =>
				match[1]?.toLowerCase(),
			);
			if (tags.includes(tag)) return { drop: true };
		}
	}
	return null;
}

/** The caniemail features an inline declaration uses, most specific first. */
function featuresOf(property: string, value: string): string[] {
	const slugs = [`css-${property}`];
	const prefix = property.split("-")[0];
	if (prefix && prefix !== property) slugs.push(`css-${prefix}`);
	if (property === "display") slugs.unshift(`css-display-${value.trim()}`);
	if (/rgba?\(/u.test(value)) slugs.push("css-rgba");
	if (/linear-gradient\(/u.test(value)) slugs.push("css-linear-gradient");
	return slugs;
}

const SEVERITY: Finding["support"][] = [
	"unsupported",
	"unsupported-here",
	"rewritten",
	"partial",
];

export function simulateClient(
	html: string,
	data: CanIEmailData,
	client: EmailClient,
	version: string,
): { html: string; findings: Finding[] } {
	const features = new Map(data.data.map((feature) => [feature.slug, feature]));
	const document = new DOMParser().parseFromString(html, "text/html");
	const findings = new Map<string, Finding>();
	const note = (
		feature: CanIEmailData["data"][number],
		support: Finding["support"],
		notes: string[],
	) => {
		const key = `${feature.slug}\u0000${support}`;
		const existing = findings.get(key);
		if (existing) existing.count += 1;
		else
			findings.set(key, {
				slug: feature.slug,
				title: feature.title,
				url: feature.url,
				support,
				count: 1,
				notes,
			});
	};

	for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
		const tag = features.get(`html-${element.tagName.toLowerCase()}`);
		const tagSupport = tag ? supportOf(tag, client, version) : null;
		if (tag && tagSupport?.level === "n")
			note(tag, "unsupported", tagSupport.notes);

		const style = element.getAttribute("style");
		if (!style) continue;
		const kept: string[] = [];
		for (const declaration of style.split(";")) {
			const colon = declaration.indexOf(":");
			if (colon === -1) continue;
			const property = declaration.slice(0, colon).trim().toLowerCase();
			const value = declaration.slice(colon + 1);
			let result: string | null = `${property}:${value}`;
			for (const slug of featuresOf(property, value)) {
				const feature = features.get(slug);
				const support = feature ? supportOf(feature, client, version) : null;
				if (!feature || !support) continue;
				const rename = partialEffect(
					support.notes,
					element.tagName.toLowerCase(),
				);
				if (support.level === "n" && rename && "rename" in rename) {
					// "Buggy. Replaces `height` by `min-height`": rewritten, not dropped.
					note(feature, "rewritten", support.notes);
					result = `${rename.rename}:${value}`;
				} else if (support.level === "n") {
					note(feature, "unsupported", support.notes);
					result = null;
				} else if (support.level === "a") {
					const effect = partialEffect(
						support.notes,
						element.tagName.toLowerCase(),
					);
					if (effect && "drop" in effect) {
						note(feature, "unsupported-here", support.notes);
						result = null;
					} else if (effect) {
						note(feature, "rewritten", support.notes);
						result = `${effect.rename}:${value}`;
					} else note(feature, "partial", support.notes);
				}
				// The most specific feature caniemail knows decides.
				break;
			}
			if (result) kept.push(result);
		}
		element.setAttribute("style", kept.join(";"));
	}

	return {
		html: document.body.innerHTML,
		findings: [...findings.values()].sort(
			(a, b) =>
				SEVERITY.indexOf(a.support) - SEVERITY.indexOf(b.support) ||
				b.count - a.count,
		),
	};
}
