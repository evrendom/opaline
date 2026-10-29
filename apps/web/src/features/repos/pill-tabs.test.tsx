import { IconFile } from "@tabler/icons-react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PillTabs } from "./pill-tabs";

const SLIDE = "transition-[transform,width]";
const TABS = [
	{ icon: IconFile, id: "a", label: "A" },
	{ icon: IconFile, id: "b", label: "B" },
] as const;

const nextFrame = () =>
	act(
		() =>
			new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
	);

describe("PillTabs", () => {
	it("places its pill without sliding, then slides it from tab to tab", async () => {
		const view = render(
			<PillTabs label="Tabs" onChange={() => {}} tabs={TABS} value="a" />,
		);
		const pill = () =>
			view.container.querySelector<HTMLElement>("span[aria-hidden='true']");
		expect(pill()).not.toBeNull();
		expect(pill()?.className).not.toContain(SLIDE);
		await nextFrame();
		expect(pill()?.className).toContain(SLIDE);
		view.rerender(
			<PillTabs label="Tabs" onChange={() => {}} tabs={TABS} value="b" />,
		);
		expect(pill()?.className).toContain(SLIDE);
	});
});
