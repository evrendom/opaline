import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseSelfHostInfo,
	SelfHostContext,
} from "@/features/self-hosted/self-host-info";
import { RetiredCliBanner } from "./RetiredCliBanner";
import {
	REMOVE_RETIRED_CLI_PATH,
	RETIRED_CLI_DISMISSED_KEY,
	RETIRED_CLI_PATH,
} from "./retired-cli";

const SELF_HOST = parseSelfHostInfo({ selfHosted: true });

function renderBanner(selfHost = SELF_HOST) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<SelfHostContext.Provider value={selfHost}>
				<RetiredCliBanner />
			</SelfHostContext.Provider>
		</QueryClientProvider>,
	);
}

function mockServer(present: boolean, removal: unknown = null) {
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) => {
			calls.push(`${init?.method ?? "GET"} ${input}`);
			if (input === RETIRED_CLI_PATH) return Response.json({ present });
			if (input === REMOVE_RETIRED_CLI_PATH)
				return removal
					? Response.json(removal)
					: Response.json(
							{ error: "remove_failed", message: "Could not remove it." },
							{ status: 500 },
						);
			return Response.json({ error: "not_found" }, { status: 404 });
		}),
	);
	return calls;
}

afterEach(() => {
	vi.unstubAllGlobals();
	window.sessionStorage.clear();
});

describe("RetiredCliBanner", () => {
	it("says the retired CLI is still installed and offers to remove it", async () => {
		mockServer(true);
		renderBanner();
		expect(
			await screen.findByText(/retired Opaline CLI is still installed/),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
		expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
	});

	it("renders nothing when the CLI is gone or the server is not the Mac app", async () => {
		const calls = mockServer(false);
		const { container } = renderBanner();
		await waitFor(() => expect(calls).toEqual([`GET ${RETIRED_CLI_PATH}`]));
		expect(container).toBeEmptyDOMElement();

		const none = renderBanner(null);
		expect(none.container).toBeEmptyDOMElement();
		expect(calls).toHaveLength(1);
	});

	it("Remove shows exactly what was removed", async () => {
		const calls = mockServer(true, {
			removed: [
				"The CLI's saved sign-in from ~/.rudel",
				"1 automatic-upload hook from ~/.claude/settings.json",
			],
			skipped: [],
			busy: false,
			present: false,
		});
		renderBanner();
		fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
		expect(
			await screen.findByText("Removed the retired Opaline CLI:"),
		).toBeInTheDocument();
		expect(
			screen.getByText("The CLI's saved sign-in from ~/.rudel"),
		).toBeInTheDocument();
		expect(
			screen.getByText("1 automatic-upload hook from ~/.claude/settings.json"),
		).toBeInTheDocument();
		expect(calls).toContain(`POST ${REMOVE_RETIRED_CLI_PATH}`);

		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() =>
			expect(
				screen.queryByRole("region", { name: /Retired Opaline CLI/ }),
			).toBeNull(),
		);
	});

	it("keeps the banner with the server's message when removing fails", async () => {
		mockServer(true);
		renderBanner();
		fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Could not remove it.",
		);
		expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
	});

	it("Not now hides it until the app is opened again", async () => {
		mockServer(true);
		const first = renderBanner();
		fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
		expect(first.container).toBeEmptyDOMElement();
		expect(window.sessionStorage.getItem(RETIRED_CLI_DISMISSED_KEY)).toBe("1");
		first.unmount();

		// A reload in the same window keeps it hidden.
		const reloaded = renderBanner();
		expect(reloaded.container).toBeEmptyDOMElement();
		reloaded.unmount();

		// A new launch starts with fresh session storage.
		window.sessionStorage.clear();
		renderBanner();
		expect(
			await screen.findByRole("button", { name: "Remove" }),
		).toBeInTheDocument();
	});
});
