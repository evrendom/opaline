import { describe, expect, test } from "bun:test";
import {
	buildGitHubUrl,
	decodePageCursor,
	encodePageCursor,
	getNextPageCursor,
} from "./github-transport.js";

describe("GitHub request construction and cursors", () => {
	test("constructs encoded URLs and omits undefined query parameters", () => {
		expect(
			buildGitHubUrl(
				"https://api.github.example/",
				"/repos/acme/widget/commits",
				{
					page: 2,
					per_page: 100,
					sha: "feature/a b",
					since: undefined,
				},
			),
		).toBe(
			"https://api.github.example/repos/acme/widget/commits?page=2&per_page=100&sha=feature%2Fa+b",
		);
	});

	test("round-trips versioned page cursors", () => {
		const pageCursor = encodePageCursor(7);
		expect(decodePageCursor(pageCursor)).toBe(7);
		expect(decodePageCursor(undefined)).toBe(1);
	});

	test("extracts only the next page from a GitHub Link header", () => {
		const cursor = getNextPageCursor(
			'<https://api.github.com/repositories/1/issues?page=3>; rel="next", <https://api.github.com/repositories/1/issues?page=8>; rel="last"',
		);
		expect(cursor).not.toBeNull();
		expect(decodePageCursor(cursor ?? undefined)).toBe(3);
		expect(getNextPageCursor(null)).toBeNull();
	});
});
