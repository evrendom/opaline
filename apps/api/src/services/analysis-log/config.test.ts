import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	analysisPurgeStores,
	getAnalysisLog,
	purgeAnalysisLogs,
	restrictsAnalysisResults,
	setAnalysisLogForTests,
} from "./config.js";
import { createSigningKeys } from "./convex-token.js";

const originalEnvironment = {
	ANALYSIS_LOG_STORE: process.env.ANALYSIS_LOG_STORE,
	CONVEX_URL: process.env.CONVEX_URL,
	ANALYSIS_LOG_SIGNING_KEY: process.env.ANALYSIS_LOG_SIGNING_KEY,
	OPENAI_API_KEY: process.env.OPENAI_API_KEY,
	ANALYSIS_LOG_PURGE_BACKENDS: process.env.ANALYSIS_LOG_PURGE_BACKENDS,
	ANALYSIS_LOG_WORKSPACES: process.env.ANALYSIS_LOG_WORKSPACES,
	ANALYSIS_LOG_RESTRICTED_WORKSPACES:
		process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES,
};
const WORKSPACE = "workspace_one";
const { signingKey } = await createSigningKeys();

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

test("stored results are restricted only in the listed workspaces", () => {
	process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES = ` other , ${WORKSPACE}`;
	expect(restrictsAnalysisResults(WORKSPACE)).toBe(true);
	expect(restrictsAnalysisResults("workspace_two")).toBe(false);
	for (const value of [undefined, "", " , "]) {
		if (value === undefined)
			delete process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES;
		else process.env.ANALYSIS_LOG_RESTRICTED_WORKSPACES = value;
		expect(restrictsAnalysisResults(WORKSPACE)).toBe(false);
		expect(restrictsAnalysisResults("")).toBe(false);
	}
});

test("memory logging needs neither Convex nor OpenAI and falls back to local vectors", () => {
	process.env.ANALYSIS_LOG_STORE = "memory";
	delete process.env.CONVEX_URL;
	delete process.env.ANALYSIS_LOG_SIGNING_KEY;
	delete process.env.OPENAI_API_KEY;
	setAnalysisLogForTests(undefined);
	const log = getAnalysisLog(WORKSPACE);
	expect(log?.embedder.model).toBe("local-word-vectors-1");
	expect(getAnalysisLog(WORKSPACE)).toBe(log);
});

test("Convex logging stays off without a deployment URL", () => {
	process.env.ANALYSIS_LOG_STORE = "convex";
	process.env.OPENAI_API_KEY = "sk-test";
	process.env.CONVEX_URL = " ";
	process.env.ANALYSIS_LOG_SIGNING_KEY = JSON.stringify(signingKey);
	setAnalysisLogForTests(undefined);
	expect(getAnalysisLog(WORKSPACE)).toBeNull();
});

test("Convex logging stays off without a valid signing key", () => {
	process.env.ANALYSIS_LOG_STORE = "convex";
	process.env.OPENAI_API_KEY = "sk-test";
	process.env.CONVEX_URL = "https://test-deployment.convex.cloud";
	for (const value of [
		"",
		"not json",
		JSON.stringify({ ...signingKey, d: undefined }),
	]) {
		process.env.ANALYSIS_LOG_SIGNING_KEY = value;
		setAnalysisLogForTests(undefined);
		expect(getAnalysisLog(WORKSPACE)).toBeNull();
	}
});

test("Convex logging refuses local vectors: it stays off without OpenAI", () => {
	process.env.ANALYSIS_LOG_STORE = "convex";
	process.env.CONVEX_URL = "https://test-deployment.convex.cloud";
	process.env.ANALYSIS_LOG_SIGNING_KEY = JSON.stringify(signingKey);
	delete process.env.OPENAI_API_KEY;
	setAnalysisLogForTests(undefined);
	expect(getAnalysisLog(WORKSPACE)).toBeNull();
});

test("Convex logging stays off until the purge is told Convex may hold analyses", () => {
	process.env.ANALYSIS_LOG_STORE = "convex";
	process.env.CONVEX_URL = "https://test-deployment.convex.cloud";
	process.env.ANALYSIS_LOG_SIGNING_KEY = JSON.stringify(signingKey);
	process.env.OPENAI_API_KEY = "sk-test";
	delete process.env.ANALYSIS_LOG_PURGE_BACKENDS;
	setAnalysisLogForTests(undefined);
	expect(getAnalysisLog(WORKSPACE)).toBeNull();
});

test("Convex logging stays off for a backend list the purge would reject", () => {
	process.env.ANALYSIS_LOG_STORE = "convex";
	process.env.CONVEX_URL = "https://test-deployment.convex.cloud";
	process.env.ANALYSIS_LOG_SIGNING_KEY = JSON.stringify(signingKey);
	process.env.OPENAI_API_KEY = "sk-test";
	for (const backends of ["convex,postgres", "convex, convx"]) {
		process.env.ANALYSIS_LOG_PURGE_BACKENDS = backends;
		setAnalysisLogForTests(undefined);
		expect(getAnalysisLog(WORKSPACE)).toBeNull();
		expect(() => analysisPurgeStores(AbortSignal.timeout(1_000))).toThrow(
			"only convex can hold analyses",
		);
	}
});

test("Convex logging embeds with OpenAI and is configured without contacting the deployment", () => {
	process.env.ANALYSIS_LOG_STORE = "convex";
	process.env.CONVEX_URL = "https://test-deployment.convex.cloud";
	process.env.ANALYSIS_LOG_SIGNING_KEY = JSON.stringify(signingKey);
	process.env.OPENAI_API_KEY = "sk-test";
	process.env.ANALYSIS_LOG_PURGE_BACKENDS = "convex";
	setAnalysisLogForTests(undefined);
	expect(getAnalysisLog(WORKSPACE)?.embedder.model).toBe(
		"text-embedding-3-small",
	);
});

test("the purge cleans Convex whenever CONVEX_URL is set, even with capture off or in memory", () => {
	process.env.CONVEX_URL = "https://test-deployment.convex.cloud";
	process.env.ANALYSIS_LOG_SIGNING_KEY = JSON.stringify(signingKey);
	for (const store of [undefined, "convex"]) {
		if (store === undefined) delete process.env.ANALYSIS_LOG_STORE;
		else process.env.ANALYSIS_LOG_STORE = store;
		setAnalysisLogForTests(undefined);
		expect(analysisPurgeStores(AbortSignal.timeout(1_000))).toHaveLength(1);
	}

	process.env.ANALYSIS_LOG_STORE = "memory";
	setAnalysisLogForTests(undefined);
	const stores = analysisPurgeStores(AbortSignal.timeout(1_000));
	expect(stores).toHaveLength(2);
	expect(stores[1]).toBe(getAnalysisLog(WORKSPACE)?.store);
});

test("the purge fails, so it is retried, when CONVEX_URL is set without a valid signing key", async () => {
	process.env.CONVEX_URL = "https://test-deployment.convex.cloud";
	for (const store of [undefined, "memory", "convex"]) {
		if (store === undefined) delete process.env.ANALYSIS_LOG_STORE;
		else process.env.ANALYSIS_LOG_STORE = store;
		for (const value of ["", "not json"]) {
			process.env.ANALYSIS_LOG_SIGNING_KEY = value;
			setAnalysisLogForTests(undefined);
			await expect(
				purgeAnalysisLogs({ targetType: "account", targetId: "user" }),
			).rejects.toThrow("analyses in Convex cannot be purged");
		}
	}
});

test("a purge fails while a declared backend lacks its URL, whatever capture uses", async () => {
	delete process.env.CONVEX_URL;
	delete process.env.ANALYSIS_LOG_SIGNING_KEY;
	process.env.ANALYSIS_LOG_PURGE_BACKENDS = " convex ";
	for (const store of [undefined, "memory", "convex"]) {
		if (store === undefined) delete process.env.ANALYSIS_LOG_STORE;
		else process.env.ANALYSIS_LOG_STORE = store;
		setAnalysisLogForTests(undefined);
		await expect(
			purgeAnalysisLogs({ targetType: "account", targetId: "user" }),
		).rejects.toThrow("declares convex but CONVEX_URL is not set");
	}
	process.env.ANALYSIS_LOG_PURGE_BACKENDS = "convex,postgres";
	expect(() => analysisPurgeStores(AbortSignal.timeout(1_000))).toThrow(
		"only convex can hold analyses",
	);
});

test("without Convex the purge cleans the memory store, or nothing", async () => {
	delete process.env.ANALYSIS_LOG_PURGE_BACKENDS;
	delete process.env.CONVEX_URL;
	delete process.env.ANALYSIS_LOG_SIGNING_KEY;
	delete process.env.ANALYSIS_LOG_STORE;
	setAnalysisLogForTests(undefined);
	expect(analysisPurgeStores(AbortSignal.timeout(1_000))).toEqual([]);
	await purgeAnalysisLogs({
		targetType: "organization",
		targetId: "workspace",
	});

	process.env.ANALYSIS_LOG_STORE = "memory";
	setAnalysisLogForTests(undefined);
	const log = getAnalysisLog(WORKSPACE);
	expect(analysisPurgeStores(AbortSignal.timeout(1_000))).toEqual(
		log ? [log.store] : [],
	);
	expect(log).not.toBeNull();
});
