export type NumberedLine = { number: number; text: string } | null;

export type OutputPart =
	| { kind: "json"; text: string; value: object }
	| {
			kind: "numbered";
			file: string | null;
			lines: NumberedLine[];
			text: string;
	  }
	| { kind: "counts"; rows: { count: string; name: string }[]; text: string }
	| { kind: "table"; header: string[]; rows: string[][]; text: string }
	| { kind: "note"; folder: string; text: string }
	| { kind: "text"; text: string };

const NOTE = /^Shell cwd was reset to (.+)$/u;
const NUMBERED = /^(\d+)[:-](.*)$|^\s*(\d+)\t(.*)$/su;
const FILE_NUMBERED = /^([^\s:]*[./][^\s:]*):(\d+)[:-](.*)$/su;
const COUNT = /^\s*(\d+)(?:\s+\d+){0,2}\s+((?:\S*[./]\S*)|total)$/u;

type Line =
	| { kind: "note"; folder: string; text: string }
	| { kind: "numbered"; file: string | null; line: NumberedLine; text: string }
	| { kind: "count"; count: string; name: string; text: string }
	| { kind: "text"; text: string };

function lineKind(text: string): Line {
	const note = NOTE.exec(text);
	if (note) return { folder: note[1] ?? "", kind: "note", text };
	if (text === "--") return { file: null, kind: "numbered", line: null, text };
	const inFile = FILE_NUMBERED.exec(text);
	if (inFile)
		return {
			file: inFile[1] ?? null,
			kind: "numbered",
			line: { number: Number(inFile[2]), text: inFile[3] ?? "" },
			text,
		};
	const numbered = NUMBERED.exec(text);
	if (numbered)
		return {
			file: null,
			kind: "numbered",
			line: {
				number: Number(numbered[1] ?? numbered[3]),
				text: numbered[2] ?? numbered[4] ?? "",
			},
			text,
		};
	const count = COUNT.exec(text);
	if (count)
		return { count: count[1] ?? "", kind: "count", name: count[2] ?? "", text };
	return { kind: "text", text };
}

function tableCells(line: string): string[] | null {
	const trimmed = line.trim();
	if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 1)
		return trimmed
			.slice(1, -1)
			.split("|")
			.map((cell) => cell.trim());
	if (!line.includes(" | ")) return null;
	return line.split(" | ").map((cell) => cell.trim());
}

const isRule = (cells: readonly string[]) =>
	cells.every((cell) => /^:?-{2,}:?$/u.test(cell));

const HEADER_CELL = /^[\p{L}\p{N}_ .()%#/-]{1,48}$/u;

function tableAt(
	lines: readonly string[],
	start: number,
): { header: string[]; lines: number; rows: string[][] } | null {
	const header = tableCells(lines[start] ?? "");
	if (!header || header.length < 2) return null;
	if (!header.every((cell) => HEADER_CELL.test(cell))) return null;
	const rows: string[][] = [];
	let end = start + 1;
	for (; end < lines.length; end++) {
		const cells = tableCells(lines[end] ?? "");
		if (!cells || cells.length !== header.length) break;
		if (end === start + 1 && isRule(cells)) continue;
		rows.push(cells);
	}
	return rows.length > 0 ? { header, lines: end - start, rows } : null;
}

function linesParts(lines: readonly string[]): OutputPart[] {
	const kinds = lines.map(lineKind);
	const parts: OutputPart[] = [];
	const text: string[] = [];
	const flush = () => {
		if (text.length > 0) parts.push({ kind: "text", text: text.join("\n") });
		text.length = 0;
	};
	for (let i = 0; i < kinds.length; ) {
		const line = kinds[i];
		if (!line) break;
		if (line.kind === "note") {
			flush();
			parts.push(line);
			i++;
			continue;
		}
		const table = line.kind === "text" ? tableAt(lines, i) : null;
		if (table) {
			flush();
			parts.push({
				header: table.header,
				kind: "table",
				rows: table.rows,
				text: lines.slice(i, i + table.lines).join("\n"),
			});
			i += table.lines;
			continue;
		}
		if (line.kind === "numbered" || line.kind === "count") {
			const continues = (next: Line | undefined) =>
				next?.kind === line.kind &&
				(next.kind !== "numbered" ||
					next.line === null ||
					(line.kind === "numbered" && next.file === line.file));
			let end = i;
			while (end < kinds.length && continues(kinds[end])) end++;
			const run = kinds.slice(i, end);
			const real = run.filter((item) => item.kind !== "numbered" || item.line);
			const enough =
				line.kind === "numbered"
					? real.length >= 2
					: real.length >= 2 ||
						run.some((item) => item.kind === "count" && item.name === "total");
			if (enough) {
				flush();
				const joined = run.map((item) => item.text).join("\n");
				parts.push(
					line.kind === "numbered"
						? {
								file: line.file,
								kind: "numbered",
								lines: run.map((item) =>
									item.kind === "numbered" ? item.line : null,
								),
								text: joined,
							}
						: {
								kind: "counts",
								rows: run.flatMap((item) =>
									item.kind === "count"
										? [{ count: item.count, name: item.name }]
										: [],
								),
								text: joined,
							},
				);
				i = end;
				continue;
			}
		}
		text.push(line.text);
		i++;
	}
	flush();
	return parts;
}

export function dedent(lines: readonly string[]): string[] {
	let shared: string | null = null;
	for (const line of lines) {
		if (!line.trim()) continue;
		const indent = /^[ \t]*/u.exec(line)?.[0] ?? "";
		if (shared === null) shared = indent;
		else {
			let common = 0;
			while (
				common < shared.length &&
				common < indent.length &&
				shared[common] === indent[common]
			)
				common++;
			shared = shared.slice(0, common);
		}
		if (shared === "") return [...lines];
	}
	const cut = shared?.length ?? 0;
	return lines.map((line) => (line.trim() ? line.slice(cut) : ""));
}

const MAX_JSON_LINES = 400;

function jsonValue(text: string): object | null {
	const trimmed = text.trim();
	if (!/^[[{]/u.test(trimmed)) return null;
	try {
		const value: unknown = JSON.parse(trimmed);
		return value !== null && typeof value === "object" ? value : null;
	} catch {
		return null;
	}
}

export function outputParts(output: string): OutputPart[] {
	const lines = output.split("\n");
	const parts: OutputPart[] = [];
	const plain: string[] = [];
	const flush = () => {
		if (plain.length > 0) parts.push(...linesParts(plain));
		plain.length = 0;
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (!/^\s*[[{]/u.test(line)) {
			plain.push(line);
			continue;
		}
		let found: { end: number; value: object } | null = null;
		for (let end = i; end < Math.min(lines.length, i + MAX_JSON_LINES); end++) {
			if (end > i && !/^\s*[\]}]/u.test(lines[end] ?? "")) continue;
			const value = jsonValue(lines.slice(i, end + 1).join("\n"));
			if (value) {
				found = { end, value };
				break;
			}
		}
		if (!found) {
			plain.push(line);
			continue;
		}
		flush();
		parts.push({
			kind: "json",
			text: JSON.stringify(found.value, null, 2),
			value: found.value,
		});
		i = found.end;
	}
	flush();
	return parts;
}
