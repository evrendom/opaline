import type { AttemptShape } from "./reader-layout";

function own(scope: Element, selector: string): HTMLElement[] {
	return [...scope.querySelectorAll<HTMLElement>(selector)].filter(
		(each) => !each.parentElement?.closest("[data-subagent]"),
	);
}

export function measureAttempts(
	list: HTMLElement,
	shapes: Map<string, AttemptShape>,
): void {
	for (const item of list.querySelectorAll<HTMLElement>(
		":scope > li[data-attempt]:not([data-attempt-pending])",
	)) {
		const id = item.dataset.attempt;
		if (!id) continue;
		const origin = item.getBoundingClientRect().top;
		const box = (each: Element) => {
			const rect = each.getBoundingClientRect();
			return { height: rect.height, top: rect.top - origin };
		};
		shapes.set(id, {
			height: item.getBoundingClientRect().height,
			rows: [...item.querySelectorAll<HTMLElement>("[data-step-row]")].map(
				(row) => {
					const own = !row.parentElement?.closest("[data-subagent]");
					return {
						...box(row),
						failed: own && row.hasAttribute("data-step-failed"),
						tags: own ? row.dataset.stepTags : undefined,
						id: row.dataset.stepRow ?? "",
						startMs: row.dataset.startMs ?? "",
					};
				},
			),
			subagents: own(item, "[data-subagent]").map((each) => ({
				...box(each.firstElementChild ?? each),
				endMs: each.dataset.subagentEndMs,
				id: each.dataset.subagentId,
				until: each.dataset.subagentUntil,
			})),
			talks: own(item, "[data-talks-to]").map((each) => ({
				...box(each),
				id: each.dataset.talksTo ?? "",
			})),
		});
	}
}
