import { describe, expect, it } from "bun:test";
import { toPostgresJson } from "./postgres-json.js";

describe("Postgres JSON conversion", () => {
	it("converts typed readonly evidence records into plain JSON values", () => {
		interface Evidence {
			readonly records: readonly { readonly state: "complete" }[];
		}
		const evidence: Evidence = { records: [{ state: "complete" }] };
		expect(toPostgresJson(evidence)).toEqual({
			records: [{ state: "complete" }],
		});
	});

	it("uses JSON serialization semantics for omitted values", () => {
		expect(toPostgresJson({ missing: undefined, values: [undefined] })).toEqual(
			{
				values: [null],
			},
		);
	});

	it("rejects values that JSON cannot serialize", () => {
		expect(() => toPostgresJson(undefined)).toThrow(
			"Postgres JSON value is not serializable",
		);
		expect(() => toPostgresJson(1n)).toThrow();
	});
});
