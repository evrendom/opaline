import { describe, expect, test } from "bun:test";
import {
	INGEST_OPERATOR_TOKEN_HEADER,
	isAuthorizedIngestOperatorRequest,
} from "./ingest-quiescence.js";

describe("session ingest operator gate", () => {
	test("requires an exact configured operator token", () => {
		const headers = new Headers({
			[INGEST_OPERATOR_TOKEN_HEADER]: "operator-secret",
		});

		expect(isAuthorizedIngestOperatorRequest(headers, "operator-secret")).toBe(
			true,
		);
		expect(isAuthorizedIngestOperatorRequest(headers, "wrong-secret")).toBe(
			false,
		);
		expect(isAuthorizedIngestOperatorRequest(headers, "")).toBe(false);
	});

	test("rejects a missing operator header", () => {
		expect(
			isAuthorizedIngestOperatorRequest(new Headers(), "operator-secret"),
		).toBe(false);
	});
});
