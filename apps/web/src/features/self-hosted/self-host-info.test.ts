import { afterEach, describe, expect, it, vi } from "vitest";
import {
	asksServerForSelfHostInfo,
	fetchSelfHostInfo,
	parseSelfHostInfo,
	SELF_HOST_INFO_PATH,
	whenSelfHostInfoKnown,
} from "./self-host-info";

const serverInfo = {
	selfHosted: true,
	version: "dev",
	appUrl: "http://localhost:4790",
	mcpUrl: "http://localhost:4790/api/mcp",
	setupComplete: true,
	auth: { password: true, emailCodes: false, social: [] },
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("parseSelfHostInfo", () => {
	it("reads the info a self-hosted server publishes", () => {
		expect(parseSelfHostInfo(serverInfo)).toEqual(serverInfo);
	});

	it("fills in what an older server leaves out instead of falling back to the cloud UI", () => {
		expect(parseSelfHostInfo({ selfHosted: true })).toEqual({
			selfHosted: true,
			version: "dev",
			appUrl: "",
			mcpUrl: "",
			setupComplete: true,
			auth: { password: true, emailCodes: false, social: [] },
		});
	});

	it("treats anything else as the cloud app", () => {
		expect(parseSelfHostInfo({ selfHosted: false })).toBeNull();
		expect(parseSelfHostInfo({ error: "not_found" })).toBeNull();
		expect(parseSelfHostInfo("<!doctype html>")).toBeNull();
		expect(parseSelfHostInfo(null)).toBeNull();
	});
});

describe("asksServerForSelfHostInfo", () => {
	it("never asks on opaline.so, so production makes no extra request", () => {
		expect(asksServerForSelfHostInfo("https://opaline.so", "production")).toBe(
			false,
		);
		expect(
			asksServerForSelfHostInfo("https://www.opaline.so", "production"),
		).toBe(false);
	});

	it("never asks from the plugin or the product demo", () => {
		expect(asksServerForSelfHostInfo("http://localhost:4790", "plugin")).toBe(
			false,
		);
		expect(
			asksServerForSelfHostInfo("http://localhost:4790", "product-demo"),
		).toBe(false);
	});

	it("asks on any other origin", () => {
		expect(
			asksServerForSelfHostInfo("http://localhost:4790", "production"),
		).toBe(true);
		expect(
			asksServerForSelfHostInfo("https://opaline.acme.lan", "production"),
		).toBe(true);
	});
});

describe("fetchSelfHostInfo", () => {
	it("asks the server once at its info path, without cookies", async () => {
		const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) =>
			Response.json(serverInfo),
		);
		await expect(
			fetchSelfHostInfo(fetchMock, "http://localhost:4790"),
		).resolves.toEqual(serverInfo);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url?.toString()).toBe(`http://localhost:4790${SELF_HOST_INFO_PATH}`);
		expect(init?.credentials).toBe("omit");
	});

	it("answers null for a cloud server's 404 and for a server that cannot be reached", async () => {
		await expect(
			fetchSelfHostInfo(
				async () => Response.json({ error: "not_found" }, { status: 404 }),
				"http://localhost:4011",
			),
		).resolves.toBeNull();
		await expect(
			fetchSelfHostInfo(async () => {
				throw new TypeError("fetch failed");
			}, "http://localhost:4011"),
		).resolves.toBeNull();
	});
});

describe("whenSelfHostInfoKnown", () => {
	it("renders the cloud app at once on opaline.so", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const known = vi.fn();
		whenSelfHostInfoKnown(known, "https://opaline.so", "production");
		expect(known).toHaveBeenCalledWith(null);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("waits for the server's answer elsewhere and keeps it for later readers", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Response.json(serverInfo));
		const module = await import("./self-host-info");
		const known = vi.fn();
		module.whenSelfHostInfoKnown(known, "http://localhost:4790", "production");
		expect(known).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(known).toHaveBeenCalledWith(serverInfo));
		expect(module.getSelfHostInfo()).toEqual(serverInfo);
		await module.loadSelfHostInfo();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
