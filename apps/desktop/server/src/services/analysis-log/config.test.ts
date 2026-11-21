import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	analysisPurgeStores,
	getAnalysisLog,
	purgeAnalysisLogs,
	restrictsAnalysisResults,
	setAnalysisLogForTests,
} from "./config.js";

const originalEnvironment = {
	ANALYSIS_LOG_STORE: process.env.ANALYSIS_LOG_STORE,
	OPENAI_API_KEY: process.env.OPENAI_API_KEY,
	ANALYSIS_LOG_PURGE_BACKENDS: process.env.ANALYSIS_LOG_PURGE_BACKENDS,
	ANALYSIS_LOG_WORKSPACES: process.env.ANALYSIS_LOG_WORKSPACES,
	ANALYSIS_LOG_RESTRICTED_WORKSPACES:
		process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES,
	OPALINE_SELF_HOSTED: process.env.OPALINE_SELF_HOSTED,
};
const WORKSPACE = "workspace_one";

beforeEach(() => {
	process.env.ANALYSIS_LOG_WORKSPACES = WORKSPACE;
});

afterEach(() => {
	for (const [name, value] of Object.entries(originalEnvironment)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	setAnalysisLogForTests(undefined);
});

test("logging stays off without a selected store", () => {
	delete process.env.ANALYSIS_LOG_STORE;
	setAnalysisLogForTests(undefined);
	expect(getAnalysisLog(WORKSPACE)).toBeNull();
});

test("capture and history run only for the listed workspaces", () => {
	process.env.ANALYSIS_LOG_STORE = "memory";
	setAnalysisLogForTests(undefined);
	process.env.ANALYSIS_LOG_WORKSPACES = ` other , ${WORKSPACE}`;
	expect(getAnalysisLog(WORKSPACE)).not.toBeNull();
	expect(getAnalysisLog("workspace_two")).toBeNull();
	for (const value of [undefined, "", " , "]) {
		if (value === undefined) delete process.env.ANALYSIS_LOG_WORKSPACES;
		else process.env.ANALYSIS_LOG_WORKSPACES = value;
		expect(getAnalysisLog(WORKSPACE)).toBeNull();
		expect(getAnalysisLog("")).toBeNull();
	}
});

test("* alone turns the log on for every workspace; * mixed with ids turns it off", () => {
	process.env.ANALYSIS_LOG_STORE = "memory";
	setAnalysisLogForTests(undefined);
	process.env.ANALYSIS_LOG_WORKSPACES = " * ";
	expect(getAnalysisLog(WORKSPACE)).not.toBeNull();
	expect(getAnalysisLog("workspace_two")).not.toBeNull();
	expect(getAnalysisLog("")).toBeNull();
	for (const value of [`*,${WORKSPACE}`, `${WORKSPACE}, *`, "*,*"]) {
		process.env.ANALYSIS_LOG_WORKSPACES = value;
		expect(getAnalysisLog(WORKSPACE)).toBeNull();
		expect(getAnalysisLog("workspace_two")).toBeNull();
	}
});

// Restricting results applies only to workspaces limited to own sessions.
const ownOnly = (id: string) => ({ id, ownSessionsOnly: true });

test("* restricts results in every workspace; * mixed with ids restricts them all", () => {
	for (const value of ["*", `*,${WORKSPACE}`]) {
		process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES = value;
		expect(restrictsAnalysisResults(ownOnly(WORKSPACE))).toBe(true);
		expect(restrictsAnalysisResults(ownOnly("workspace_two"))).toBe(true);
	}
});

test("stored results are restricted only in the listed workspaces", () => {
	process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES = ` other , ${WORKSPACE}`;
	expect(restrictsAnalysisResults(ownOnly(WORKSPACE))).toBe(true);
	expect(restrictsAnalysisResults(ownOnly("workspace_two"))).toBe(false);
	for (const value of [undefined, "", " , "]) {
		if (value === undefined)
			delete process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES;
		else process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES = value;
		expect(restrictsAnalysisResults(ownOnly(WORKSPACE))).toBe(false);
		expect(restrictsAnalysisResults(ownOnly(""))).toBe(false);
	}
});

test("a workspace where every member reads every session never restricts results, even when listed", () => {
	for (const value of ["*", WORKSPACE, `*,${WORKSPACE}`]) {
		process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES = value;
		expect(
			restrictsAnalysisResults({ id: WORKSPACE, ownSessionsOnly: false }),
		).toBe(false);
	}
});

test("memory logging needs no OpenAI and falls back to local vectors", () => {
	process.env.ANALYSIS_LOG_STORE = "memory";
	delete process.env.OPENAI_API_KEY;
	setAnalysisLogForTests(undefined);
	const log = getAnalysisLog(WORKSPACE);
	expect(log?.embedder.model).toBe("local-word-vectors-1");
	expect(getAnalysisLog(WORKSPACE)).toBe(log);
});

test("without postgres the purge cleans the memory store, or nothing", async () => {
	delete process.env.ANALYSIS_LOG_PURGE_BACKENDS;
	delete process.env.ANALYSIS_LOG_STORE;
	setAnalysisLogForTests(undefined);
	expect(analysisPurgeStores()).toEqual([]);
	await purgeAnalysisLogs({
		targetType: "organization",
		targetId: "workspace",
	});

	process.env.ANALYSIS_LOG_STORE = "memory";
	setAnalysisLogForTests(undefined);
	const log = getAnalysisLog(WORKSPACE);
	expect(analysisPurgeStores()).toEqual(log ? [log.store] : []);
	expect(log).not.toBeNull();
});

test("Postgres logging captures only once the purge is told Postgres may hold analyses", () => {
	process.env.ANALYSIS_LOG_STORE = "postgres";
	delete process.env.OPENAI_API_KEY;
	for (const backends of [undefined, "mysql", "postgres,mysql"]) {
		if (backends === undefined) delete process.env.ANALYSIS_LOG_PURGE_BACKENDS;
		else process.env.ANALYSIS_LOG_PURGE_BACKENDS = backends;
		setAnalysisLogForTests(undefined);
		expect(getAnalysisLog(WORKSPACE)).toBeNull();
		if (backends?.includes("mysql"))
			expect(() => analysisPurgeStores()).toThrow(
				"only postgres can hold analyses",
			);
	}
	process.env.ANALYSIS_LOG_PURGE_BACKENDS = " postgres ";
	setAnalysisLogForTests(undefined);
	expect(getAnalysisLog(WORKSPACE)?.embedder.model).toBe(
		"local-word-vectors-1",
	);
	expect(getAnalysisLog("workspace_two")).toBeNull();
	process.env.OPENAI_API_KEY = "sk-test";
	setAnalysisLogForTests(undefined);
	expect(getAnalysisLog(WORKSPACE)?.embedder.model).toBe(
		"text-embedding-3-small",
	);
});

test("the purge cleans Postgres whenever postgres is declared, without contacting it", () => {
	process.env.ANALYSIS_LOG_PURGE_BACKENDS = "postgres";
	for (const store of [undefined, "memory", "postgres"]) {
		if (store === undefined) delete process.env.ANALYSIS_LOG_STORE;
		else process.env.ANALYSIS_LOG_STORE = store;
		setAnalysisLogForTests(undefined);
		expect(analysisPurgeStores()).toHaveLength(store === "memory" ? 2 : 1);
	}
});

test("a self-hosted server keeps every workspace's analyses in Postgres unless memory is asked for, and always purges Postgres", () => {
	process.env.OPALINE_SELF_HOSTED = "1";
	delete process.env.ANALYSIS_LOG_WORKSPACES;
	delete process.env.ANALYSIS_LOG_PURGE_BACKENDS;
	delete process.env.OPENAI_API_KEY;
	for (const store of [undefined, "postgres", "other"]) {
		if (store === undefined) delete process.env.ANALYSIS_LOG_STORE;
		else process.env.ANALYSIS_LOG_STORE = store;
		setAnalysisLogForTests(undefined);
		expect(getAnalysisLog("any_workspace")?.embedder.model).toBe(
			"local-word-vectors-1",
		);
		expect(getAnalysisLog("")).toBeNull();
		expect(analysisPurgeStores()).toHaveLength(1);
	}
	process.env.ANALYSIS_LOG_STORE = "memory";
	setAnalysisLogForTests(undefined);
	const stores = analysisPurgeStores();
	expect(stores).toHaveLength(2);
	expect(stores[1]).toBe(getAnalysisLog("any_workspace")?.store);
});
