import { ORPCError } from "@orpc/server";
import { CLI_DATA_LIMITS, type DataChunk } from "@rudel/api-routes/cli-data";
import { redactReturnedText } from "@rudel/secret-filter";

const STRING_TOKEN = /"(?:[^"\\]|\\.)*"/gu;

export function redactJsonText(json: string): string {
	return json.replace(STRING_TOKEN, (token: string, offset: number) => {
		if (json[offset + token.length] === ":") return token;
		const value = JSON.parse(token) as string;
		const redacted = redactReturnedText(value);
		return redacted === value ? token : JSON.stringify(redacted);
	});
}

export function arrayElements(line: string): string[] {
	const text = line.trim();
	if (!text.startsWith("[") || !text.endsWith("]"))
		throw new Error("Expected a JSON array row from ClickHouse");
	const elements: string[] = [];
	let depth = 0;
	let start = 1;
	let inString = false;
	for (let index = 1; index < text.length - 1; index++) {
		const code = text.charCodeAt(index);
		if (inString) {
			if (code === 92) index++;
			else if (code === 34) inString = false;
			continue;
		}
		if (code === 34) inString = true;
		else if (code === 91 || code === 123) depth++;
		else if (code === 93 || code === 125) depth--;
		else if (code === 44 && depth === 0) {
			elements.push(text.slice(start, index).trim());
			start = index + 1;
		}
	}
	const last = text.slice(start, text.length - 1).trim();
	if (last !== "" || elements.length > 0) elements.push(last);
	return elements;
}

export function columnNames(headerLine: string): string[] {
	return arrayElements(headerLine).map((name) => String(JSON.parse(name)));
}

function csvText(value: string): string {
	return value === "" || /[",\r\n]/u.test(value)
		? `"${value.replaceAll('"', '""')}"`
		: value;
}

function csvCell(raw: string): string {
	if (raw === "null") return "";
	if (raw.startsWith('"'))
		return csvText(redactReturnedText(JSON.parse(raw) as string));
	if (raw.startsWith("[") || raw.startsWith("{"))
		return csvText(redactJsonText(raw));
	return raw;
}

export function csvHeader(names: readonly string[]): string {
	return names.map(csvText).join(",");
}

export function compactRowToCsv(line: string): string {
	return arrayElements(line).map(csvCell).join(",");
}

export function compactRowToJsonl(
	names: readonly string[],
	line: string,
): string {
	const elements = arrayElements(line);
	return `{${names
		.map(
			(name, index) =>
				`${JSON.stringify(name)}:${redactJsonText(elements[index] ?? "null")}`,
		)
		.join(",")}}`;
}

export function tooLarge(
	maxBytes: number,
	how: string,
): ORPCError<"EXPORT_TOO_LARGE", { maxBytes: number }> {
	return new ORPCError("EXPORT_TOO_LARGE", {
		status: 413,
		message: `The export is larger than ${maxBytes / 1024 / 1024} MiB, the most one call sends. ${how}`,
		data: { maxBytes },
	});
}

export const NARROW_EXPORT =
	"Narrow the query (a shorter time range, fewer sessions, fewer or narrower columns) or aggregate it with GROUP BY, then run it again.";

const SLICE_UNITS = 262_144;

export class ChunkWriter {
	rows = 0;
	bytes = 0;
	private parts: string[] = [];
	private pending = 0;

	constructor(
		private readonly maxBytes: number,
		private readonly how: string,
		private readonly chunkBytes: number = CLI_DATA_LIMITS.chunkBytes,
	) {}

	line(text: string, counted = true): DataChunk[] {
		const full = `${text}\n`;
		const size = Buffer.byteLength(full);
		if (this.bytes + size > this.maxBytes)
			throw tooLarge(this.maxBytes, this.how);
		this.bytes += size;
		if (counted) this.rows += 1;
		const ready: DataChunk[] = [];
		if (this.pending + size > this.chunkBytes && this.pending > 0)
			ready.push(this.take());
		if (size <= this.chunkBytes) {
			this.parts.push(full);
			this.pending += size;
			return ready;
		}
		for (const piece of slices(full, this.chunkBytes))
			ready.push({ type: "lines", text: piece });
		return ready;
	}

	flush(): DataChunk[] {
		return this.pending > 0 ? [this.take()] : [];
	}

	done(columns: readonly string[], notices: readonly string[]): DataChunk {
		return {
			type: "done",
			rows: this.rows,
			bytes: this.bytes,
			columns: [...columns],
			notices: [...notices],
		};
	}

	private take(): DataChunk {
		const chunk: DataChunk = { type: "lines", text: this.parts.join("") };
		this.parts = [];
		this.pending = 0;
		return chunk;
	}
}

function* slices(text: string, maxBytes: number): Generator<string> {
	const units = Math.min(SLICE_UNITS, Math.floor(maxBytes / 3));
	let start = 0;
	while (start < text.length) {
		let end = Math.min(text.length, start + units);
		const last = text.charCodeAt(end - 1);
		if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
		yield text.slice(start, end);
		start = end;
	}
}
