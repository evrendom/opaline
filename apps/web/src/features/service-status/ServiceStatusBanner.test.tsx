import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceStatusBanner } from "./ServiceStatusBanner";

function renderBanner() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ServiceStatusBanner />
		</QueryClientProvider>,
	);
}

function mockReadiness(clickhouse: string) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json(
				{
					status: clickhouse === "ok" ? "ok" : "unavailable",
					dependencies: {
						postgres: { status: "ok" },
						clickhouse: { status: clickhouse },
					},
				},
				{ status: clickhouse === "ok" ? 200 : 503 },
			),
		),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ServiceStatusBanner", () => {
	it("tells users analytics are unavailable while ClickHouse is down", async () => {
		mockReadiness("unavailable");
		renderBanner();
		expect(
			await screen.findByText(/Analytics are temporarily unavailable/),
		).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent(
			"Your session uploads are safe",
		);
	});

	it("renders nothing while ClickHouse is healthy", async () => {
		mockReadiness("ok");
		const { container } = renderBanner();
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when the readiness check cannot be reached", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		const { container } = renderBanner();
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(container).toBeEmptyDOMElement();
	});
});
