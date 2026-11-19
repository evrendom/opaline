import { afterEach, expect, test } from "bun:test";
import {
	readLatestCliVersion,
	resetLatestCliVersionForTests,
} from "../services/cli-version.service.js";

const saved = process.env.OPALINE_SELF_HOSTED;

afterEach(() => {
	if (saved === undefined) delete process.env.OPALINE_SELF_HOSTED;
	else process.env.OPALINE_SELF_HOSTED = saved;
	resetLatestCliVersionForTests();
});

test("a self-hosted server never asks npm for the latest CLI", async () => {
	process.env.OPALINE_SELF_HOSTED = "1";
	let called = false;
	const fetchLatest = (async () => {
		called = true;
		return Response.json({ version: "9.9.9" });
	}) as unknown as typeof fetch;
	expect(await readLatestCliVersion(fetchLatest)).toBeNull();
	expect(called).toBe(false);
});
