import { expect, test } from "bun:test";
import type { StoredUploadFailure } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionUploadFailureDetail } from "./components/session-upload-failure-detail";
import {
	getSessionOverviewCost,
	matchesSessionOverviewRangeFilters,
} from "./components/sessions-overview-table-utils";
import { orderSessionsForDisplay } from "./session-ordering";
import {
	getSessionUploadFailure,
	mergeSessionUploadFailures,
	uploadFailureSession,
} from "./session-upload-failure";

const failure: StoredUploadFailure = {
	id: "cli-failure:sample",
	sessionId: "session-without-transcript",
	userId: "member-1",
	source: "codex",
	repository: "github.com/opalinehq/athena",
	projectPath: "/projects/athena",
	gitRemote: "github.com/opalinehq/athena",
	gitBranch: "main",
	gitSha: "12345678",
	cliVersion: "0.8.1",
	sessionDate: null,
	failedAt: "2026-09-17T14:00:00.000Z",
	stage: "preparing",
	totalBytes: 150 * 1024 * 1024,
	uploadedBytes: 0,
	maxBytes: 128 * 1024 * 1024,
	error: "Transcript exceeds the 128 MiB limit",
	errorCode: "CLI_UPLOAD_FAILED",
	retryable: false,
	attempts: 0,
};

test("detail recovery trusts the refreshed row and direct links never show another session's error", () => {
	const row = uploadFailureSession(failure);
	expect(getSessionUploadFailure(failure.sessionId, row, [])).toEqual(failure);
	expect(
		getSessionUploadFailure(
			failure.sessionId,
			{ ...row, upload_failure: undefined },
			[failure],
		),
	).toBeUndefined();
	expect(
		getSessionUploadFailure(failure.sessionId, undefined, [failure]),
	).toEqual(failure);
	expect(
		getSessionUploadFailure("another-session", undefined, [failure]),
	).toBeUndefined();
});

test("failed sessions keep their normal ID and known metadata without inventing cost or dates", () => {
	const row = uploadFailureSession(failure);
	expect(row.session_id).toBe(failure.sessionId);
	expect(row.git_branch).toBe("main");
	expect(row.upload_failure?.sessionDate).toBeNull();
	expect(row.session_date).toBe(failure.failedAt);
	expect(getSessionOverviewCost(row)).toBeNull();
	expect(
		matchesSessionOverviewRangeFilters(row, {
			cost: { minimum: 0, maximum: 5 },
			duration: { minimum: null, maximum: null },
			errors: { minimum: null, maximum: null },
			input: { minimum: null, maximum: null },
			output: { minimum: null, maximum: null },
			subagents: { minimum: null, maximum: null },
		}),
	).toBe(false);
});

test("diagnostics use the same chronological list, deduplicate repeated pages and disappear after successful retry", () => {
	const uploaded = {
		...uploadFailureSession(failure),
		upload_failure: undefined,
		session_date: "2026-09-16T08:00:00.000Z",
	};
	const different = { ...uploaded, session_id: "another-session" };
	const rows = mergeSessionUploadFailures(
		[uploaded, different],
		[failure, failure],
	);
	expect(rows).toHaveLength(2);
	expect(
		orderSessionsForDisplay({ sessions: rows })[0]?.upload_failure,
	).toEqual(failure);
	expect(mergeSessionUploadFailures([uploaded, different], [])).toEqual([
		uploaded,
		different,
	]);
});

test("the detail page exposes the error and all stored diagnostics, including zero attempts and bytes", () => {
	const html = renderToStaticMarkup(
		<SessionUploadFailureDetail failure={failure} userLabel="Test member" />,
	);
	for (const value of [
		"Upload failed",
		failure.error,
		failure.sessionId,
		"Session date",
		"Unavailable",
		failure.failedAt.slice(0, 4),
		"Test member",
		"157,286,400 bytes",
		"0 bytes",
		"128 MiB",
		"CLI_UPLOAD_FAILED",
		"0.8.1",
		"12345678",
	]) {
		expect(html).toContain(value);
	}
	expect(html).not.toContain("Retry this session with");
	expect(
		renderToStaticMarkup(
			<SessionUploadFailureDetail
				failure={{ ...failure, retryable: true }}
				userLabel="Test member"
			/>,
		),
	).toContain("opaline upload");
});
