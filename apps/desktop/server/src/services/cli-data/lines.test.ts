import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import {
	arrayElements,
	ChunkWriter,
	columnNames,
	compactRowToCsv,
	compactRowToJsonl,
	csvHeader,
	redactJsonText,
} from "./lines.js";

const SECRET = "ghp_0123456789abcdefghijABCDEFGHIJ012345";

describe("redactJsonText", () => {
	test("redacts secrets inside string values and leaves keys and numbers as ClickHouse wrote them", () => {
		const line = `{"text":"token ${SECRET} here","fingerprint":18446744073709551615,"ok":true}`;
		const redacted = redactJsonText(line);
		expect(redacted).not.toContain(SECRET);
		expect(redacted).toContain('"fingerprint":18446744073709551615');
		expect(JSON.parse(redacted).text).toContain("[redacted]");
	});

	test("keeps a line without secrets byte for byte, escapes included", () => {
		const line = '{"path":"\\/private\\/tmp","quote":"say \\"hi\\"\\n"}';
		expect(redactJsonText(line)).toBe(line);
	});
});

describe("arrayElements", () => {
	test("splits a compact row at top-level commas only", () => {
		expect(
			arrayElements(
				'["a, b", [1,2], {"k":"v,w"}, null, 18446744073709551615, "x\\"]"]',
			),
		).toEqual([
			'"a, b"',
			"[1,2]",
			'{"k":"v,w"}',
			"null",
			"18446744073709551615",
			'"x\\"]"',
		]);
	});

	test("reads an empty row as no elements", () => {
		expect(arrayElements("[]")).toEqual([]);
	});
});

describe("compact rows", () => {
	const names = columnNames('["session_id", "turns", "models", "note"]');

	test("become JSONL objects with the column names, numbers kept exact", () => {
		const line = compactRowToJsonl(
			names,
			'["s-1", 18446744073709551615, ["opus"], null]',
		);
		expect(line).toBe(
			'{"session_id":"s-1","turns":18446744073709551615,"models":["opus"],"note":null}',
		);
	});

	test("become CSV rows: NULL empty, empty strings quoted, quotes and newlines escaped, arrays as JSON", () => {
		expect(csvHeader(names)).toBe("session_id,turns,models,note");
		expect(compactRowToCsv('["a \\"b\\"\\nc", 2, ["x","y"], null]')).toBe(
			'"a ""b""\nc",2,"[""x"",""y""]",',
		);
		expect(compactRowToCsv('["", 0, [], ""]')).toBe('"",0,[],""');
	});

	test("redact secrets in JSONL and CSV", () => {
		const row = `["${SECRET}", 1, ["${SECRET}"], null]`;
		expect(compactRowToJsonl(names, row)).not.toContain(SECRET);
		expect(compactRowToCsv(row)).not.toContain(SECRET);
	});
});

describe("ChunkWriter", () => {
	const read = (chunks: { type: string; text?: string }[]) =>
		chunks.map((chunk) => chunk.text ?? "").join("");

	test("packs whole lines into chunks no larger than the chunk size", () => {
		const writer = new ChunkWriter(10_000, "narrow", 25);
		const chunks = [
			...writer.line("aaaaaaaaaa"),
			...writer.line("bbbbbbbbbb"),
			...writer.line("cccccccccc"),
			...writer.flush(),
		];
		expect(chunks).toEqual([
			{ type: "lines", text: "aaaaaaaaaa\nbbbbbbbbbb\n" },
			{ type: "lines", text: "cccccccccc\n" },
		]);
		expect(writer.done(["c"], ["n"])).toEqual({
			type: "done",
			rows: 3,
			bytes: 33,
			columns: ["c"],
			notices: ["n"],
		});
	});

	test("spreads a line longer than a chunk over several chunks without splitting a character", () => {
		const writer = new ChunkWriter(10_000, "narrow", 12);
		const long = "x".repeat(3) + "😀".repeat(5);
		const chunks = [
			...writer.line("first"),
			...writer.line(long),
			...writer.flush(),
		];
		for (const chunk of chunks)
			if (chunk.type === "lines")
				expect(Buffer.byteLength(chunk.text)).toBeLessThanOrEqual(12);
		expect(read(chunks)).toBe(`first\n${long}\n`);
		expect(read(chunks)).not.toContain("�");
	});

	test("does not count a header as a row", () => {
		const writer = new ChunkWriter(10_000, "narrow");
		writer.line("a,b", false);
		writer.line("1,2");
		expect(writer.done([], [])).toMatchObject({ rows: 1, bytes: 8 });
	});

	test("refuses past the byte cap with EXPORT_TOO_LARGE and says how to narrow", () => {
		const writer = new ChunkWriter(10, "Narrow it.", 4);
		writer.line("12345");
		let thrown: unknown;
		try {
			writer.line("67890");
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ORPCError);
		expect((thrown as ORPCError<string, unknown>).code).toBe(
			"EXPORT_TOO_LARGE",
		);
		expect((thrown as ORPCError<string, unknown>).message).toContain(
			"Narrow it.",
		);
		expect((thrown as ORPCError<string, unknown>).data).toEqual({
			maxBytes: 10,
		});
	});
});
