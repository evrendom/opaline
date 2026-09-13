import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionModelMark } from "./session-model-mark";

for (const { value, maximumValue, expected } of [
	{ value: 0, maximumValue: 0, expected: 0 },
	{ value: 0, maximumValue: 10, expected: 0 },
	{ value: 2.5, maximumValue: 10, expected: 25 },
	{ value: 10, maximumValue: 10, expected: 100 },
	{ value: 20, maximumValue: 10, expected: 100 },
	{ value: -1, maximumValue: 10, expected: 0 },
]) {
	test(`model background progress: ${value} / ${maximumValue} renders ${expected}% without another layer`, () => {
		const html = renderToStaticMarkup(
			<SessionModelMark
				avatarUrl={undefined}
				model="claude-sonnet-4"
				progress={{ label: "API cost", value, maximumValue }}
				showMember={false}
				userLabel="Demo"
			/>,
		);
		expect(html).toContain(`aria-valuenow="${expected}"`);
		expect(html).toContain("data-session-model-background");
		expect(html).not.toContain("conic-gradient");
		if (expected > 0) {
			expect(html).toContain('stroke-linecap="round"');
			expect(html).toContain('stroke-width="3"');
			expect(html).toContain('pathLength="100"');
		} else {
			// A zero-length round-capped dash would still draw a dot.
			expect(html).not.toContain('stroke-linecap="round"');
		}
		if (expected > 0 && expected < 100) {
			expect(html).toContain(`stroke-dasharray="${expected} 100"`);
		} else {
			expect(html).not.toContain("stroke-dasharray");
		}
		expect(html).toContain("bg-white");
		// Round caps are drawn inside the original background, not outside the icon.
		expect(html.match(/data-session-model-background/g)).toHaveLength(1);
		expect(html.match(/<svg/g)).toHaveLength(expected > 0 ? 2 : 1);
	});
}

test("model marks without a cost preserve their existing appearance", () => {
	const html = renderToStaticMarkup(
		<SessionModelMark
			avatarUrl={undefined}
			model="gpt-5"
			showMember={false}
			userLabel="Demo"
		/>,
	);
	expect(html).not.toContain('role="progressbar"');
	expect(html).not.toContain("data-session-model-progress");
	expect(html).toContain("data-session-detail-model-mark");
});
