import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildReport,
	formatReport,
	parseCsv,
	type Row,
	readTable,
	snapshot,
	toCsv,
	upsert,
} from "./repo-stats.js";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "repo-stats-test-"));
	directories.push(directory);
	return directory;
}

function download(
	date: string,
	tag: string,
	id: number,
	asset: string,
	createdAt: string,
	downloads: number,
): Row {
	return {
		date,
		tag,
		asset_id: String(id),
		asset,
		created_at: createdAt,
		downloads: String(downloads),
	};
}

test("CSV keeps commas, quotes and line breaks in fields", () => {
	const rows = [{ path: "/a,b", title: 'say "hi"\nthere' }];
	expect(parseCsv(toCsv(["path", "title"], rows))).toEqual(rows);
});

test("upsert replaces rows with the same key and keeps the rest", () => {
	const merged = upsert(
		[
			{ date: "2026-11-01", views: "1" },
			{ date: "2026-11-02", views: "2" },
		],
		[
			{ date: "2026-11-02", views: "5" },
			{ date: "2026-11-03", views: "3" },
		],
		["date"],
	);
	expect(merged.map((row) => `${row.date}=${row.views}`)).toEqual([
		"2026-11-01=1",
		"2026-11-02=5",
		"2026-11-03=3",
	]);
});

test("the report keeps installs from a DMG that publish replaced", () => {
	const report = buildReport([
		download(
			"2026-12-01",
			"desktop-latest",
			1,
			"Opaline-macOS-arm64.dmg",
			"2026-11-20T10:00:00Z",
			40,
		),
		download(
			"2026-12-02",
			"desktop-latest",
			1,
			"Opaline-macOS-arm64.dmg",
			"2026-11-20T10:00:00Z",
			50,
		),
		download(
			"2026-12-03",
			"desktop-latest",
			2,
			"Opaline-macOS-arm64.dmg",
			"2026-12-03T09:00:00Z",
			7,
		),
		download(
			"2026-12-03",
			"desktop-v1.1.0",
			3,
			"Opaline-1.1.0.dmg",
			"2026-12-03T09:00:00Z",
			3,
		),
	]);
	expect(report.installs).toBe(60);
});

test("the update rate compares a release's zip downloads with earlier installs", () => {
	const report = buildReport([
		download(
			"2026-12-02",
			"desktop-latest",
			1,
			"Opaline-macOS-arm64.dmg",
			"2026-11-20T10:00:00Z",
			50,
		),
		download(
			"2026-12-05",
			"desktop-latest",
			1,
			"Opaline-macOS-arm64.dmg",
			"2026-11-20T10:00:00Z",
			80,
		),
		download(
			"2026-12-05",
			"desktop-v1.0.0",
			4,
			"Opaline-1.0.0-darwin-arm64.zip",
			"2026-11-20T10:00:00Z",
			0,
		),
		download(
			"2026-12-09",
			"desktop-v1.1.0",
			5,
			"Opaline-1.1.0-darwin-arm64.zip",
			"2026-12-03T09:00:00Z",
			30,
		),
	]);
	expect(report.releases).toEqual([
		{
			tag: "desktop-v1.0.0",
			date: "2026-11-20",
			updates: 0,
			installsBefore: 0,
			updateRate: null,
		},
		{
			tag: "desktop-v1.1.0",
			date: "2026-12-03",
			updates: 30,
			installsBefore: 50,
			updateRate: 0.6,
		},
	]);
});

test("active installs come from daily growth of the update feed's downloads", () => {
	const feed = "desktop-update-darwin-arm64.json";
	const report = buildReport([
		download(
			"2026-12-01",
			"desktop-latest",
			9,
			feed,
			"2026-11-20T10:00:00Z",
			100,
		),
		download(
			"2026-12-02",
			"desktop-latest",
			9,
			feed,
			"2026-11-20T10:00:00Z",
			160,
		),
		download(
			"2026-12-03",
			"desktop-latest",
			9,
			feed,
			"2026-11-20T10:00:00Z",
			190,
		),
	]);
	expect(report.checks).toEqual([
		{ date: "2026-12-02", checks: 60, activeEstimate: 20 },
		{ date: "2026-12-03", checks: 30, activeEstimate: 10 },
	]);
	expect(formatReport(report)).toContain("2026-12-03  ~10  (30 checks)");
});

function fakeGitHub(trafficStatus = 200) {
	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	return async (url: string) => {
		const path = new URL(url).pathname;
		if (path.endsWith("/releases"))
			return json([
				{
					tag_name: "desktop-latest",
					assets: [
						{
							id: 1,
							name: "Opaline-macOS-arm64.dmg",
							created_at: "2026-11-20T10:00:00Z",
							download_count: 12,
						},
					],
				},
			]);
		if (path.includes("/traffic/")) {
			if (trafficStatus !== 200)
				return json({ message: "Must have push access" }, trafficStatus);
			if (path.endsWith("/views"))
				return json({
					views: [{ timestamp: "2026-11-19T00:00:00Z", count: 30, uniques: 9 }],
				});
			if (path.endsWith("/clones"))
				return json({
					clones: [{ timestamp: "2026-11-19T00:00:00Z", count: 4, uniques: 2 }],
				});
			if (path.endsWith("/referrers"))
				return json([
					{ referrer: "news.ycombinator.com", count: 20, uniques: 7 },
				]);
			if (path.endsWith("/paths"))
				return json([
					{
						path: "/evrendom/opaline",
						title: "opaline, the app",
						count: 25,
						uniques: 8,
					},
				]);
		}
		return json({
			stargazers_count: 5,
			forks_count: 1,
			subscribers_count: 2,
			open_issues_count: 3,
		});
	};
}

test("a snapshot saves downloads, the repository and all four traffic tables", async () => {
	const directory = temporaryDirectory();
	const result = await snapshot({
		repository: "owner/repo",
		directory,
		today: "2026-11-19",
		trafficToken: "token",
		fetch: fakeGitHub(),
	});
	expect(result.warnings).toEqual([]);
	expect(readTable(directory, "downloads")[0]?.downloads).toBe("12");
	expect(readTable(directory, "repository")[0]?.stars).toBe("5");
	expect(readTable(directory, "views")).toEqual([
		{ date: "2026-11-19", views: "30", unique_visitors: "9" },
	]);
	expect(readTable(directory, "paths")[0]?.title).toBe("opaline, the app");
});

test("a snapshot still saves downloads when the traffic token is missing or refused", async () => {
	for (const [trafficToken, status] of [
		[undefined, 200],
		["token", 403],
	] as const) {
		const directory = temporaryDirectory();
		const result = await snapshot({
			repository: "owner/repo",
			directory,
			today: "2026-11-19",
			trafficToken,
			fetch: fakeGitHub(status),
		});
		expect(result.tables).toEqual(["downloads", "repository"]);
		expect(result.warnings).toHaveLength(1);
		expect(readTable(directory, "views")).toEqual([]);
	}
});
