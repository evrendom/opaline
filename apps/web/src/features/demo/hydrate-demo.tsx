import { flushSync } from "react-dom";
import { hydrateRoot } from "react-dom/client";
import { usesSafariDemoMotion } from "../../../../marketing/src/scripts/demo-browser";
import { DemoRoot } from "./demo-root";
import { DemoSeedSchema } from "./demo-runtime";

export async function hydrateDemo() {
	const root = document.getElementById("root");
	const seed = document.getElementById("demo-seed");
	if (!root || !seed?.textContent)
		throw new Error("Demo document is incomplete");
	const hydrate = () =>
		hydrateRoot(
			root,
			<DemoRoot seed={DemoSeedSchema.parse(JSON.parse(seed.textContent))} />,
			{
				onRecoverableError(error) {
					document.documentElement.dataset.demoHydrationError = "";
					console.error("Product demo hydration failed", error);
				},
			},
		);
	if (usesSafariDemoMotion(navigator.userAgent)) {
		// The activation download can finish during a quick exit. Don't hydrate
		// temporary animation children or let another transition interrupt the
		// initial commit after the presentation tree has been restored.
		while (document.documentElement.hasAttribute("data-safari-demo-motion")) {
			await new Promise<void>((resolve) => {
				const observer = new MutationObserver(() => {
					if (document.documentElement.hasAttribute("data-safari-demo-motion"))
						return;
					observer.disconnect();
					resolve();
				});
				observer.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ["data-safari-demo-motion"],
				});
			});
		}
		flushSync(hydrate);
	} else {
		hydrate();
	}
}
