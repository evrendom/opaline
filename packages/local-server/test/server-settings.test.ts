import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readServerSettings,
	SERVER_SETTINGS_FILE,
} from "../src/server-settings.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-server-settings-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("server.env", () => {
	test("is optional", () => {
		expect(readServerSettings(root)).toEqual({
			path: join(root, SERVER_SETTINGS_FILE),
			settings: {},
			problems: [],
		});
	});

	test("passes server settings on, quoted or not, and skips comments and blank lines", () => {
		writeFileSync(
			join(root, SERVER_SETTINGS_FILE),
			[
				"# invite-only unless this is 1",
				"OPALINE_OPEN_SIGNUP=1",
				"",
				"export OPALINE_SQL_QUOTA_PER_HOUR = 600",
				'S3_PUBLIC_ENDPOINT="http://nas.local:8333"',
				"S3_SECRET_ACCESS_KEY='a=b#c'",
				"EMPTY=",
			].join("\n"),
		);
		expect(readServerSettings(root)).toMatchObject({
			settings: {
				OPALINE_OPEN_SIGNUP: "1",
				OPALINE_SQL_QUOTA_PER_HOUR: "600",
				S3_PUBLIC_ENDPOINT: "http://nas.local:8333",
				S3_SECRET_ACCESS_KEY: "a=b#c",
				EMPTY: "",
			},
			problems: [],
		});
	});

	test("never overrides what opaline server sets itself, and says which lines it skipped", () => {
		writeFileSync(
			join(root, SERVER_SETTINGS_FILE),
			"PORT=9999\nBETTER_AUTH_SECRET=mine\nnot a setting\nRESEND_API_KEY=re_1\n",
		);
		const { settings, problems } = readServerSettings(root);
		expect(settings).toEqual({ RESEND_API_KEY: "re_1" });
		expect(problems).toHaveLength(3);
		expect(problems[0]).toContain("PORT in ");
		expect(problems[1]).toContain("BETTER_AUTH_SECRET in ");
		expect(problems[2]).toContain("line 3 is not NAME=value");
	});
});
