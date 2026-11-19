import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { strict as assert } from "node:assert";
import {
	createGitHubAuthorization,
	createGitHubRepositorySource,
	GITHUB_REST_API_VERSION,
	type RepositoryCoordinates,
} from "./index.js";

const REPOSITORY: RepositoryCoordinates = { owner: "acme", name: "widget" };
const TOKEN = "github_pat_private-test-value";
const JSON_HEADERS = { "content-type": "application/json" };
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

let fixture: ReturnType<typeof Bun.serve>;
let fixtureBaseUrl = "";
let logFixture: ReturnType<typeof Bun.serve>;
let logFixtureBaseUrl = "";
let rateLimitCalls = 0;
let secondaryLimitCalls = 0;
let jobLogRetryCalls = 0;
const JOB_LOG_CONTENT = "checkout complete\ntests passed\n";
const jobLogRequests: Array<{
	path: string;
	authorization: string | null;
	apiVersion: string | null;
}> = [];
const requests: Array<{
	path: string;
	authorization: string | null;
	apiVersion: string | null;
	ifNoneMatch: string | null;
}> = [];

beforeAll(() => {
	logFixture = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			jobLogRequests.push({
				path: url.pathname,
				authorization: request.headers.get("authorization"),
				apiVersion: request.headers.get("x-github-api-version"),
			});
			if (url.pathname === "/job-logs/88") {
				return new Response(JOB_LOG_CONTENT, {
					headers: {
						"content-length": String(byteLength(JOB_LOG_CONTENT)),
						"content-type": "text/plain; charset=utf-8",
					},
				});
			}
			if (url.pathname === "/job-logs/87") {
				return new Response("tests failed\n", {
					headers: { "content-length": "13", "content-type": "text/plain" },
				});
			}
			if (url.pathname === "/job-logs/89") {
				return new Response("0123456789abcdefghijklmnopqrstuvwxyz", {
					headers: { "content-length": "36", "content-type": "text/plain" },
				});
			}
			return new Response(null, { status: 404 });
		},
	});
	logFixtureBaseUrl = `http://127.0.0.1:${logFixture.port}`;
	fixture = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			requests.push({
				path: `${url.pathname}${url.search}`,
				authorization: request.headers.get("authorization"),
				apiVersion: request.headers.get("x-github-api-version"),
				ifNoneMatch: request.headers.get("if-none-match"),
			});
			return fixtureResponse(request, url);
		},
	});
	fixtureBaseUrl = `http://127.0.0.1:${fixture.port}`;
});

afterAll(() => {
	fixture.stop(true);
	logFixture.stop(true);
});

describe("GitHub repository source", () => {
	test("redacts credentials and sends the current GitHub API version", async () => {
		requests.length = 0;
		const authorization = createGitHubAuthorization(TOKEN);
		const source = createGitHubRepositorySource({
			authorization,
			baseUrl: fixtureBaseUrl,
		});

		const result = await source.getCommit(REPOSITORY, "main");
		assert(result.status === "available");
		expect(result.data.sha).toBe("commit-1");
		expect(JSON.stringify(authorization)).toBe('"[REDACTED]"');
		expect(String(authorization)).toBe("[REDACTED]");
		expect(JSON.stringify(source)).not.toContain(TOKEN);
		expect(requests[0]?.authorization).toBe(`Bearer ${TOKEN}`);
		expect(requests[0]?.apiVersion).toBe(GITHUB_REST_API_VERSION);
		expect(GITHUB_REST_API_VERSION).toBe("2026-03-10");
	});

	test("never serializes credentials into request errors", async () => {
		const source = createGitHubRepositorySource({
			authorization: createGitHubAuthorization(TOKEN),
			baseUrl: fixtureBaseUrl,
			maxRetries: 0,
		});
		let caught: unknown = null;
		try {
			await source.getCommit({ owner: "acme", name: "always-limited" }, "main");
		} catch (error) {
			caught = error;
		}
		expect(caught).not.toBeNull();
		expect(JSON.stringify(caught)).not.toContain(TOKEN);
	});

	test("retries rate limits using Retry-After and reports exhausted limits", async () => {
		rateLimitCalls = 0;
		const sleeps: number[] = [];
		const source = createGitHubRepositorySource({
			baseUrl: fixtureBaseUrl,
			maxRetries: 1,
			sleep: async (milliseconds) => {
				sleeps.push(milliseconds);
			},
		});
		const result = await source.getCommit(
			{ owner: "acme", name: "rate-limited" },
			"main",
		);
		assert(result.status === "available");
		expect(rateLimitCalls).toBe(2);
		expect(sleeps).toEqual([0]);

		const exhausted = createGitHubRepositorySource({
			baseUrl: fixtureBaseUrl,
			maxRetries: 0,
		});
		await expect(
			exhausted.getCommit({ owner: "acme", name: "always-limited" }, "main"),
		).rejects.toMatchObject({
			kind: "rate-limit",
			retryAfterMs: 2_000,
		});

		secondaryLimitCalls = 0;
		const secondarySleeps: number[] = [];
		const secondary = createGitHubRepositorySource({
			baseUrl: fixtureBaseUrl,
			maxRetries: 1,
			sleep: async (milliseconds) => {
				secondarySleeps.push(milliseconds);
			},
		});
		const secondaryResult = await secondary.getCommit(
			{ owner: "acme", name: "secondary-limited" },
			"main",
		);
		assert(secondaryResult.status === "available");
		expect(secondarySleeps).toEqual([60_000]);
	});

	test("validates API responses before normalization", async () => {
		const source = createGitHubRepositorySource({ baseUrl: fixtureBaseUrl });
		await expect(
			source.getCommit({ owner: "acme", name: "invalid" }, "main"),
		).rejects.toMatchObject({ kind: "invalid-response" });
	});

	test("normalizes commits and workflow job steps", async () => {
		const source = createGitHubRepositorySource({ baseUrl: fixtureBaseUrl });
		const commit = await source.getCommit(REPOSITORY, "main");
		assert(commit.status === "available");
		expect(commit.data).toMatchObject({ sha: "commit-1" });

		const jobs = await source.listWorkflowJobs(REPOSITORY, "77", {
			cursor: undefined,
			pageSize: 50,
		});
		assert(jobs.status === "available");
		expect(jobs.items[0]).toMatchObject({
			id: "88",
			runId: "77",
			steps: [
				{
					number: 1,
					name: "Checkout",
					status: "completed",
					conclusion: "success",
				},
			],
		});
		expect(requests.at(-1)?.path).toContain("filter=all");
	});

	test("filters workflow runs by exact head SHA and retains jobs from every attempt", async () => {
		requests.length = 0;
		const source = createGitHubRepositorySource({ baseUrl: fixtureBaseUrl });
		const runs = await source.listWorkflowRuns(
			REPOSITORY,
			undefined,
			{ cursor: undefined, pageSize: 100 },
			HEAD_SHA,
		);
		assert(runs.status === "available");
		expect(runs.items.map((run) => run.headSha)).toEqual([HEAD_SHA]);
		expect(requests.at(-1)?.path).toContain(`head_sha=${HEAD_SHA}`);

		const jobs = await source.listWorkflowJobs(REPOSITORY, "78", {
			cursor: undefined,
			pageSize: 100,
		});
		assert(jobs.status === "available");
		expect(
			jobs.items.map((job) => [job.id, job.runAttempt, job.conclusion]),
		).toEqual([
			["87", 1, "failure"],
			["88", 2, "success"],
		]);
		expect(requests.at(-1)?.path).toContain("filter=all");

		const logs = await Promise.all(
			jobs.items.map((job) =>
				source.getWorkflowJobLog(REPOSITORY, job.id, 1_024),
			),
		);
		expect(
			logs.map((log) =>
				log.status === "available"
					? [log.data.jobId, log.data.content, log.coverage.state]
					: ["unavailable"],
			),
		).toEqual([
			["87", "tests failed\n", "complete"],
			["88", JOB_LOG_CONTENT, "complete"],
		]);
	});

	test("follows the job-log redirect without caching or disclosing credentials", async () => {
		requests.length = 0;
		jobLogRequests.length = 0;
		let cacheReads = 0;
		let cacheWrites = 0;
		const source = createGitHubRepositorySource({
			authorization: createGitHubAuthorization(TOKEN),
			baseUrl: fixtureBaseUrl,
			conditionalCache: {
				async get() {
					cacheReads += 1;
					return null;
				},
				async set() {
					cacheWrites += 1;
				},
			},
		});

		const result = await source.getWorkflowJobLog(REPOSITORY, "88", 1_024);
		assert(result.status === "available");
		expect(result.data).toEqual({
			jobId: "88",
			content: JOB_LOG_CONTENT,
			contentBytes: byteLength(JOB_LOG_CONTENT),
			originalByteLength: byteLength(JOB_LOG_CONTENT),
			contentType: "text/plain; charset=utf-8",
			truncated: false,
			sensitivity: "secret-bearing",
			persistence: "secret-filter-required",
		});
		expect(result.coverage).toEqual({ state: "complete", reasons: [] });
		expect(result.provenance.endpoint).toBe(
			"/repos/acme/widget/actions/jobs/88/logs",
		);
		expect(result.provenance.requestId).toBe("job-log-request-88");
		expect(result.provenance.transfer).toMatchObject({
			downloadedBytes: byteLength(JOB_LOG_CONTENT),
			conditional: "disabled",
		});
		expect(cacheWrites).toBe(0);
		expect(cacheReads).toBe(0);
		expect(jobLogRequests).toEqual([
			{ path: "/job-logs/88", authorization: null, apiVersion: null },
		]);
		expect(
			requests.find((request) =>
				request.path.includes("/actions/jobs/88/logs"),
			),
		).toMatchObject({
			authorization: `Bearer ${TOKEN}`,
			apiVersion: GITHUB_REST_API_VERSION,
		});
		expect(JSON.stringify(result)).not.toContain(TOKEN);
	});

	test("returns a bounded job-log prefix with explicit partial coverage", async () => {
		const source = createGitHubRepositorySource({ baseUrl: fixtureBaseUrl });
		const result = await source.getWorkflowJobLog(REPOSITORY, "89", 10);
		assert(result.status === "available");
		expect(result.data).toMatchObject({
			content: "0123456789",
			contentBytes: 10,
			originalByteLength: 36,
			truncated: true,
		});
		expect(result.coverage).toEqual({
			state: "partial",
			reasons: [expect.objectContaining({ code: "local-byte-cap" })],
		});
		expect(result.provenance.transfer.downloadedBytes).toBe(10);
	});

	test("uses retained bytes as original length for a complete log without Content-Length", async () => {
		const content = "streamed complete log\n";
		const bytes = new TextEncoder().encode(content);
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				},
			}),
			{ headers: { "content-type": "text/plain" } },
		);
		const source = createGitHubRepositorySource({
			baseUrl: "https://api.github.test",
			fetch: Object.assign(
				(..._arguments: Parameters<typeof globalThis.fetch>) =>
					Promise.resolve(response),
				{ preconnect: globalThis.fetch.preconnect },
			),
		});

		const result = await source.getWorkflowJobLog(REPOSITORY, "94", 1_024);

		assert(result.status === "available");
		expect(result.data).toMatchObject({
			content,
			contentBytes: bytes.byteLength,
			originalByteLength: bytes.byteLength,
			truncated: false,
		});
	});

	test("drops a private key block whose footer falls past the byte cap", async () => {
		const prefix = "step 1 ok\n";
		const log = `${prefix}${PEM_HEADER}\n${PEM_BODY}\n${PEM_FOOTER}\nstep 2 ok\n`;
		const cap = byteLength(
			`${prefix}${PEM_HEADER}\n${PEM_BODY}\n-----END PRIV`,
		);

		const result = await getLogFromBody(log, cap);

		assert(result.status === "available");
		expect(result.data).toMatchObject({
			content: prefix,
			contentBytes: byteLength(prefix),
			originalByteLength: byteLength(log),
			truncated: true,
		});
		expect(result.data.content).not.toContain("BEGIN");
		expect(result.data.content).not.toContain(PEM_BODY);
		expect(result.coverage.state).toBe("partial");
	});

	test("keeps a private key block whose footer is inside the byte cap for the secret filter", async () => {
		const block = `${PEM_HEADER}\n${PEM_BODY}\n${PEM_FOOTER}\n`;
		const log = `start\n${block}tail that is cut`;
		const cap = byteLength(`start\n${block}tail`);

		const result = await getLogFromBody(log, cap);

		assert(result.status === "available");
		expect(result.data.content).toBe(`start\n${block}tail`);
		expect(result.data.truncated).toBe(true);
	});

	test("does not alter a complete log that mentions a private key header", async () => {
		const log = `grep for ${PEM_HEADER} in the tree\n`;

		const result = await getLogFromBody(log, 1_024);

		assert(result.status === "available");
		expect(result.data.content).toBe(log);
		expect(result.data.truncated).toBe(false);
	});

	test("retries transient job-log failures and preserves permission failures", async () => {
		jobLogRetryCalls = 0;
		const sleeps: number[] = [];
		const source = createGitHubRepositorySource({
			baseUrl: fixtureBaseUrl,
			maxRetries: 1,
			sleep: async (milliseconds) => {
				sleeps.push(milliseconds);
			},
		});
		const retried = await source.getWorkflowJobLog(REPOSITORY, "90", 1_024);
		assert(retried.status === "available");
		expect(retried.data.content).toBe(JOB_LOG_CONTENT);
		expect(jobLogRetryCalls).toBe(2);
		expect(sleeps).toEqual([250]);

		const forbidden = await source.getWorkflowJobLog(REPOSITORY, "91", 1_024);
		expect(forbidden.status).toBe("unavailable");
		expect(forbidden.availability).toMatchObject({
			state: "unavailable",
			reason: "forbidden",
		});
		expect(forbidden.coverage.reasons).toContainEqual(
			expect.objectContaining({ code: "permission-gated" }),
		);
	});

	test("collects paginated check-run annotations with exact diagnostic fields", async () => {
		const source = createGitHubRepositorySource({ baseUrl: fixtureBaseUrl });
		const result = await source.listCheckRunAnnotations(REPOSITORY, "501", {
			cursor: undefined,
			pageSize: 100,
		});
		assert(result.status === "available");
		expect(result.items).toEqual([
			{
				annotationLevel: "failure",
				blobHref: "https://github.example/blob/main/src/index.ts#L17",
				endColumn: 9,
				endLine: 17,
				message: "Type 'number' is not assignable to type 'string'.",
				path: "src/index.ts",
				rawDetails: "TS2322",
				startColumn: 2,
				startLine: 17,
				title: "TypeScript error",
			},
		]);
	});

	test("does not disclose authorization tokens through job-log errors", async () => {
		const source = createGitHubRepositorySource({
			authorization: createGitHubAuthorization(TOKEN),
			baseUrl: fixtureBaseUrl,
			maxRetries: 0,
		});
		let caught: unknown = null;
		try {
			await source.getWorkflowJobLog(REPOSITORY, "92", 1_024);
		} catch (error) {
			caught = error;
		}
		expect(caught).not.toBeNull();
		expect(caught).toMatchObject({ kind: "server", status: 500 });
		expect(JSON.stringify(caught)).not.toContain(TOKEN);
	});

	test("rejects HTTPS-to-HTTP job-log redirects", async () => {
		const downgradeFetch: typeof globalThis.fetch = Object.assign(
			(..._arguments: Parameters<typeof globalThis.fetch>) =>
				Promise.resolve(
					new Response(null, {
						status: 302,
						headers: { location: "http://signed-storage.test/job.log" },
					}),
				),
			{ preconnect: globalThis.fetch.preconnect },
		);
		const source = createGitHubRepositorySource({
			baseUrl: "https://api.github.test",
			maxRetries: 0,
			fetch: downgradeFetch,
		});
		await expect(
			source.getWorkflowJobLog(REPOSITORY, "93", 1_024),
		).rejects.toMatchObject({
			kind: "invalid-response",
			message:
				"GitHub redirect attempted to downgrade a sensitive response to HTTP",
		});
	});
});

function fixtureResponse(_request: Request, url: URL): Response {
	if (url.pathname === "/repos/acme/rate-limited/commits/main") {
		rateLimitCalls += 1;
		return rateLimitCalls === 1
			? new Response(null, { status: 429, headers: { "retry-after": "0" } })
			: jsonResponse(commitFixture("rate-limited-sha", "rate-limited-tree"));
	}
	if (url.pathname === "/repos/acme/always-limited/commits/main") {
		return new Response(null, {
			status: 429,
			headers: { "retry-after": "2" },
		});
	}
	if (url.pathname === "/repos/acme/secondary-limited/commits/main") {
		secondaryLimitCalls += 1;
		return secondaryLimitCalls === 1
			? Response.json(
					{ message: "You have exceeded a secondary rate limit." },
					{ status: 403 },
				)
			: jsonResponse(
					commitFixture("secondary-limited-sha", "secondary-limited-tree"),
				);
	}
	if (url.pathname === "/repos/acme/invalid/commits/main") {
		return jsonResponse([{ name: 42 }]);
	}
	if (url.pathname === "/repos/acme/widget/actions/runs/77/jobs") {
		return jsonResponse({
			total_count: 1,
			jobs: [
				{
					id: 88,
					run_id: 77,
					run_attempt: 1,
					name: "test",
					status: "completed",
					conclusion: "success",
					head_sha: "head-sha",
					started_at: "2026-09-18T12:00:00Z",
					completed_at: "2026-09-18T12:01:00Z",
					html_url: "https://github.example/acme/widget/actions/runs/77/job/88",
					labels: ["ubuntu-latest"],
					steps: [
						{
							number: 1,
							name: "Checkout",
							status: "completed",
							conclusion: "success",
							started_at: "2026-09-18T12:00:00Z",
							completed_at: "2026-09-18T12:00:05Z",
						},
					],
				},
			],
		});
	}
	if (url.pathname === "/repos/acme/widget/check-runs/501/annotations") {
		return jsonResponse([
			{
				annotation_level: "failure",
				blob_href: "https://github.example/blob/main/src/index.ts#L17",
				end_column: 9,
				end_line: 17,
				message: "Type 'number' is not assignable to type 'string'.",
				path: "src/index.ts",
				raw_details: "TS2322",
				start_column: 2,
				start_line: 17,
				title: "TypeScript error",
			},
		]);
	}
	if (url.pathname === "/repos/acme/widget/actions/runs") {
		return jsonResponse({
			total_count: 1,
			workflow_runs: [workflowRunFixture(78, HEAD_SHA)],
		});
	}
	if (url.pathname === "/repos/acme/widget/actions/runs/78/jobs") {
		return jsonResponse({
			total_count: 2,
			jobs: [
				workflowJobFixture(87, 78, 1, "failure"),
				workflowJobFixture(88, 78, 2, "success"),
			],
		});
	}
	if (url.pathname === "/repos/acme/widget/actions/jobs/87/logs") {
		return Response.redirect(`${logFixtureBaseUrl}/job-logs/87`, 302);
	}
	if (url.pathname === "/repos/acme/widget/actions/jobs/88/logs") {
		return new Response(null, {
			status: 302,
			headers: {
				location: `${logFixtureBaseUrl}/job-logs/88`,
				"x-github-request-id": "job-log-request-88",
			},
		});
	}
	if (url.pathname === "/repos/acme/widget/actions/jobs/89/logs") {
		return Response.redirect(`${logFixtureBaseUrl}/job-logs/89`, 302);
	}
	if (url.pathname === "/repos/acme/widget/actions/jobs/90/logs") {
		jobLogRetryCalls += 1;
		return jobLogRetryCalls === 1
			? new Response("temporary", { status: 503 })
			: Response.redirect(`${logFixtureBaseUrl}/job-logs/88`, 302);
	}
	if (url.pathname === "/repos/acme/widget/actions/jobs/91/logs") {
		return new Response(null, { status: 403 });
	}
	if (url.pathname === "/repos/acme/widget/actions/jobs/92/logs") {
		return Response.json({ message: TOKEN }, { status: 500 });
	}
	if (url.pathname === "/repos/acme/widget/commits/main") {
		return jsonResponse(commitFixture("commit-1", "tree-1"));
	}
	return new Response(null, { status: 404 });
}

function commitFixture(sha: string, treeSha: string): object {
	return {
		sha,
		html_url: `https://github.example/acme/widget/commit/${sha}`,
		commit: {
			message: "fixture",
			author: {
				name: "Fixture",
				email: "fixture@example.com",
				date: "2026-09-01T00:00:00Z",
			},
			committer: {
				name: "Fixture",
				email: "fixture@example.com",
				date: "2026-09-01T00:00:00Z",
			},
			tree: { sha: treeSha },
		},
		author: { id: 3, login: "fixture", type: "User" },
		committer: { id: 3, login: "fixture", type: "User" },
		parents: [],
	};
}

function workflowRunFixture(id: number, headSha: string): object {
	return {
		id,
		node_id: `RUN_${id}`,
		name: "CI",
		display_title: "Test workflow",
		workflow_id: 12,
		run_number: id,
		run_attempt: 2,
		event: "push",
		status: "completed",
		conclusion: "success",
		head_branch: "main",
		head_sha: headSha,
		created_at: "2026-09-18T12:00:00Z",
		updated_at: "2026-09-18T12:02:00Z",
		run_started_at: "2026-09-18T12:00:00Z",
		html_url: `https://github.example/acme/widget/actions/runs/${id}`,
	};
}

function workflowJobFixture(
	id: number,
	runId: number,
	runAttempt: number,
	conclusion: "failure" | "success",
): object {
	return {
		id,
		run_id: runId,
		run_attempt: runAttempt,
		name: "test",
		status: "completed",
		conclusion,
		head_sha: HEAD_SHA,
		started_at: "2026-09-18T12:00:00Z",
		completed_at: "2026-09-18T12:01:00Z",
		html_url: `https://github.example/acme/widget/actions/runs/${runId}/job/${id}`,
		labels: ["ubuntu-latest"],
		steps: [],
	};
}

const PEM_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
const PEM_FOOTER = "-----END RSA PRIVATE KEY-----";
const PEM_BODY = [
	"MIIEowIBAAKCAQEA7VJTUt9Us8cKjMzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6d",
	"VMvDuictGeurT8jNbvJZHtCSuYEvuNMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCPykc",
].join("\n");

function getLogFromBody(body: string, maxBytes: number) {
	const source = createGitHubRepositorySource({
		baseUrl: "https://api.github.test",
		fetch: Object.assign(
			(..._arguments: Parameters<typeof globalThis.fetch>) =>
				Promise.resolve(
					new Response(body, {
						headers: {
							"content-length": String(byteLength(body)),
							"content-type": "text/plain",
						},
					}),
				),
			{ preconnect: globalThis.fetch.preconnect },
		),
	});
	return source.getWorkflowJobLog(REPOSITORY, "95", maxBytes);
}

function byteLength(content: string): number {
	return new TextEncoder().encode(content).byteLength;
}

function jsonResponse(
	body: object,
	headers: Record<string, string> = {},
): Response {
	return Response.json(body, { headers: { ...JSON_HEADERS, ...headers } });
}
