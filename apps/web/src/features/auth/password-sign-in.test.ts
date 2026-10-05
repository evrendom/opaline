import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PASSWORD_SIGN_IN_CHECK_DELAY_MS,
	PASSWORD_SIGN_IN_RETRY_DELAY_MS,
	usePasswordSignIn,
} from "./password-sign-in";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));

vi.mock("@/lib/auth-client", () => ({
	authClient: { $fetch: mockAuthFetch },
}));

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

describe("usePasswordSignIn", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockAuthFetch.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries a failed lookup once after a short backoff", async () => {
		mockAuthFetch
			.mockRejectedValueOnce(new Error("network down"))
			.mockResolvedValue({ data: { available: true } });
		const { result } = renderHook(() =>
			usePasswordSignIn("reviewer@example.com"),
		);

		await advance(PASSWORD_SIGN_IN_CHECK_DELAY_MS);
		expect(mockAuthFetch).toHaveBeenCalledTimes(1);
		expect(result.current).toBe(false);

		await advance(PASSWORD_SIGN_IN_RETRY_DELAY_MS);
		expect(mockAuthFetch).toHaveBeenCalledTimes(2);
		expect(result.current).toBe(true);
	});

	it("does not ask again after the server said no", async () => {
		mockAuthFetch.mockResolvedValue({ data: { available: false } });
		const { result } = renderHook(() => usePasswordSignIn("ada@example.com"));

		await advance(PASSWORD_SIGN_IN_CHECK_DELAY_MS);
		await advance(PASSWORD_SIGN_IN_RETRY_DELAY_MS);
		await act(async () => {
			window.dispatchEvent(new Event("focus"));
		});

		expect(mockAuthFetch).toHaveBeenCalledTimes(1);
		expect(result.current).toBe(false);
	});
});
