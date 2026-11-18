// Where a clicked element sits in the digest email, in words: the section,
// the part (a box, a pill, a row, a day's bar) and the text it shows. The
// template names its parts with classes (section-<id>, metric-<id>, pill,
// share-row, day-bar, …); this reads them so lab feedback never has to be
// guessed from a bare `td`.

const clean = (value: string | null | undefined, max = 60) => {
	const text = (value ?? "").replace(/\s+/gu, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The text of a section's header row: its title, then its side note. */
/** The section's heading: its first child, the title with or without its chip. */
function sectionTitle(section: Element): string {
	return clean(section.firstElementChild?.textContent);
}

/** The weekday of a day bar: the first cell of its row. */
function dayOf(bar: Element): string {
	return clean(bar.closest(".day-row")?.querySelector("td")?.textContent);
}

/** Each named part around `element`, outermost first. */
function parts(element: Element): string[] {
	const found: string[] = [];
	const add = (selector: string, describe: (match: Element) => string) => {
		const match = element.closest(selector);
		if (match) found.push(describe(match));
	};
	add(".email-logo", () => "logo");
	add(".email-date", (match) => `date “${clean(match.textContent)}”`);
	add(".email-title", (match) => `title “${clean(match.textContent)}”`);
	add(".hero", () => "top numbers");
	add(".section", (match) => `section “${sectionTitle(match)}”`);
	add(".metric", (match) => {
		const id = [...match.classList]
			.find((name) => name.startsWith("metric-"))
			?.slice("metric-".length);
		return `box “${id ?? clean(match.textContent, 30)}”`;
	});
	add(".agent-split", () => "agent split bar");
	add(".agent-legend", (match) => `agent legend “${clean(match.textContent)}”`);
	add(".share-row", (match) => {
		const label = clean(match.querySelector("td")?.textContent, 40);
		const kind = match.querySelector(".bar-model")
			? "model row"
			: match.querySelector(".bar-repository")
				? "repository row"
				: "row";
		return `${kind} “${label}”`;
	});
	add(".bar-repository, .bar-model", () => "bar");
	add(".day-bar", (match) => `bar for ${dayOf(match)}`);
	add(".pill", (match) => `pill “${clean(match.textContent, 40)}”`);
	add(".phrase", (match) => `phrase “${clean(match.textContent, 40)}”`);
	add(
		".frustration-session",
		(match) => `session row “${clean(match.textContent)}”`,
	);
	add(
		".frustration-session-count",
		(match) => `session count “${clean(match.textContent)}”`,
	);
	add(".team-invite", () => "invite your team");
	add(".email-cta", () => "call to action");
	add(".email-footer", () => "footer");
	add(".email-button", (match) => `button “${clean(match.textContent)}”`);
	add(".email-footnote", () => "footnote");
	add(".email-address", () => "address");
	return found;
}

/**
 * The element's place in the email, e.g. `section “Where you worked” › repository
 * row “acme/web” › bar`, ending with the clicked element's own text when it
 * adds something.
 */
export function describePlacement(element: Element): string {
	const named = parts(element);
	const own = clean(element.textContent, 50);
	if (own && !named.some((part) => part.includes(own)))
		named.push(`text “${own}”`);
	if (element.tagName === "IMG") {
		const file = (element as HTMLImageElement).src.split("/").at(-1) ?? "";
		named.push(
			file.startsWith("section-")
				? "section icon"
				: file.startsWith("logo-")
					? "wordmark"
					: `icon ${file.replace(/\.png$/u, "")}`,
		);
	}
	return named.length
		? named.join(" › ")
		: `untitled ${element.tagName.toLowerCase()}`;
}
