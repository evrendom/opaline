import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ciAccessOf } from "../use-session-run-ci";
import { SessionReaderTabs } from "./session-reader-tabs";

const tabs = (ci: boolean) =>
	renderToStaticMarkup(
		<SessionReaderTabs
			ci={ci}
			empty={new Set()}
			onChange={() => {}}
			value="summary"
		/>,
	);

describe("the CI & PRs tab follows the workspace's run_ci canary", () => {
	test("shown where CI is on", () => {
		expect(tabs(true)).toContain("CI &amp; PRs");
	});

	test("gone where it is off, the other views kept", () => {
		const markup = tabs(false);
		expect(markup).not.toContain("CI &amp; PRs");
		for (const label of ["Summary", "Detail", "Files", "Setup"])
			expect(markup).toContain(label);
	});
});

describe("ciAccessOf", () => {
	test("on and off only once the API has answered", () => {
		expect(ciAccessOf({ status: "pending" })).toBe("unknown");
		expect(ciAccessOf({ status: "error" })).toBe("unknown");
		expect(ciAccessOf({ enabled: true, runs: [], status: "ready" })).toBe("on");
		expect(ciAccessOf({ enabled: false, runs: [], status: "ready" })).toBe(
			"off",
		);
	});
});
