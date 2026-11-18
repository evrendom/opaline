import { describe, expect, test } from "bun:test";
import { isLoopbackHostname, parseSafeTarget } from "../src/safety.ts";

describe("target safety", () => {
	test("allows loopback targets without remote confirmation", () => {
		expect(
			parseSafeTarget({
				allowRemote: false,
				confirmTarget: undefined,
				label: "test target",
				rawUrl: "http://127.0.0.1:4010",
			}).origin,
		).toBe("http://127.0.0.1:4010");
		expect(isLoopbackHostname("127.42.1.9")).toBe(true);
		expect(isLoopbackHostname("::1")).toBe(true);
	});

	test("requires both opt-in flags for remote HTTPS targets", () => {
		expect(() =>
			parseSafeTarget({
				allowRemote: false,
				confirmTarget: undefined,
				label: "test target",
				rawUrl: "https://preview.example.test",
			}),
		).toThrow("--allow-remote");
		expect(() =>
			parseSafeTarget({
				allowRemote: true,
				confirmTarget: "https://wrong.example.test",
				label: "test target",
				rawUrl: "https://preview.example.test",
			}),
		).toThrow("--confirm-target exactly equal");
		expect(
			parseSafeTarget({
				allowRemote: true,
				confirmTarget: "https://preview.example.test",
				label: "test target",
				rawUrl: "https://preview.example.test",
			}).origin,
		).toBe("https://preview.example.test");
	});

	test("rejects remote plaintext and embedded credentials", () => {
		expect(() =>
			parseSafeTarget({
				allowRemote: true,
				confirmTarget: "http://preview.example.test",
				label: "test target",
				rawUrl: "http://preview.example.test",
			}),
		).toThrow("must use HTTPS");
		expect(() =>
			parseSafeTarget({
				allowRemote: true,
				confirmTarget: "https://preview.example.test",
				label: "test target",
				rawUrl: "https://user:secret@preview.example.test",
			}),
		).toThrow("embedded credentials");
	});
});
