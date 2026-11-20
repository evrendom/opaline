import { HighlightedCode, languageOf } from "./session-reader-step-payloads";

export type Heredoc = {
	lead: string;
	language: string;
	body: string;
};

const OPENER = /<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/u;

const LANGUAGE_BY_PROGRAM: Record<string, string> = {
	bash: "bash",
	bun: "typescript",
	clickhouse: "sql",
	deno: "typescript",
	duckdb: "sql",
	node: "javascript",
	perl: "perl",
	psql: "sql",
	python: "python",
	python3: "python",
	ruby: "ruby",
	sh: "bash",
	sqlite3: "sql",
	tsx: "typescript",
	zsh: "bash",
};

function languageFor(lead: string): string {
	const target = /(?:>{1,2}|\btee\s+(?:-a\s+)?)\s*['"]?([^\s'"|;&<>]+)/u.exec(
		lead,
	)?.[1];
	if (target) return languageOf(target);
	const program = lead
		.trim()
		.split(/\s+/u)
		.find((word) => !/^\w+=/u.test(word))
		?.split("/")
		.at(-1);
	return (program && LANGUAGE_BY_PROGRAM[program]) ?? "text";
}

export function getHeredocs(command: string): Heredoc[] {
	const lines = command.split("\n");
	const out: Heredoc[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] as string;
		const opener = OPENER.exec(line);
		if (!opener) continue;
		const [, dash, , marker] = opener;
		const end = lines.findIndex(
			(candidate, at) =>
				at > index && (dash ? candidate.trim() : candidate) === marker,
		);
		const stop = end === -1 ? lines.length : end;
		const body = lines.slice(index + 1, stop).join("\n");
		if (body.trim()) {
			const lead = line.slice(0, opener.index).trim();
			out.push({ body, language: languageFor(line), lead });
		}
		index = stop;
	}
	return out;
}

export function HeredocBodies({ command }: { command: string }) {
	const heredocs = getHeredocs(command).map((heredoc, place) => ({
		...heredoc,
		key: `${place}:${heredoc.lead}`,
	}));
	if (heredocs.length === 0) return null;
	return (
		<div className="flex flex-col gap-m">
			{heredocs.map((heredoc) => (
				<div key={heredoc.key} className="flex flex-col gap-xs">
					<span className="truncate px-xs font-data text-body-s text-ink-3">
						{heredoc.lead || "heredoc"}
					</span>
					<HighlightedCode
						code={heredoc.body}
						language={heredoc.language}
						startLine={1}
					/>
				</div>
			))}
		</div>
	);
}
