import { describe, expect, test } from "bun:test";
import { appendVaryHeader } from "./http-response-policy.js";

describe("HTTP response policy headers", () => {
	test("appends a Vary value without dropping or duplicating existing values", () => {
		const headers = new Headers({ Vary: "Accept-Encoding" });

		appendVaryHeader(headers, "Origin");
		appendVaryHeader(headers, "origin");

		expect(headers.get("Vary")).toBe("Accept-Encoding, Origin");
	});
});
