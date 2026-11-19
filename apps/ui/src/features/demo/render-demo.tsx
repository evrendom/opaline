import { renderToString } from "react-dom/server";
import { DemoRoot } from "./demo-root";
import { DemoSeedSchema } from "./demo-runtime";
import fixture from "./seed.json";

export function renderDemo() {
	const seed = DemoSeedSchema.parse(fixture);
	return {
		html: renderToString(<DemoRoot seed={seed} />),
		seed: JSON.stringify(seed).replaceAll("<", "\\u003c"),
	};
}
