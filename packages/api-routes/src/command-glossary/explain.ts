import { describeCommand } from "../command-identity.js";
import {
	parseShellCommand,
	shellCommandSpans,
} from "../session-transcript/transcript-records/command-class.js";
import { EXPLAIN_RULES, FILTER_RULES } from "./explain-rules.js";
import type { FigSpec } from "./fig-spec.js";
import { FIG_SPECS } from "./generated/fig/index.js";
import { parseArguments } from "./parse-arguments.js";
import type { RuleContext } from "./rules/context.js";
import type { ExplainedStep, Segment } from "./sentence.js";
import {
	backquotesAsSubstitutions,
	capturedSubstitution,
	extractSubstitutions,
	hereDocuments,
	keepLiteralBackslashes,
	substitutionOf,
} from "./shell-rewrites.js";
import {
	ASSIGNMENT,
	BODY_KEYWORDS,
	basename,
	CLOSING_KEYWORDS,
	CONNECTORS,
	structureStep,
	unwrap,
	VARIABLE,
} from "./shell-structure.js";
import {
	alsoNote,
	bracketed,
	QUIET_FLAGS,
	redirectNotes,
	unexplained,
	versionOrHelp,
	wordMeanings,
} from "./step-notes.js";

export type { ExplainedStep, Segment } from "./sentence.js";

type SpecLoader = (program: string) => Promise<FigSpec | null>;

const loadFigSpec: SpecLoader = async (program) => {
	const load = FIG_SPECS[program];
	return load ? load() : null;
};

const quote = (word: string) =>
	/^[\w@%+=:,./~-]+$/u.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

export async function explainCommand(
	command: string,
	loadSpec: SpecLoader = loadFigSpec,
): Promise<ExplainedStep[]> {
	const quoted = backquotesAsSubstitutions(command);
	const { origin, restore, subs, text } = extractSubstitutions(quoted.text);
	const prepared = keepLiteralBackslashes(text);
	const statements = parseShellCommand(prepared.text);
	const spans = shellCommandSpans(prepared.text);
	const aligned = spans.length === statements.length;
	const inCommand = (at: number) =>
		quoted.origin[origin[prepared.origin[at] ?? 0] ?? 0] ?? 0;
	const starts = new WeakMap<ExplainedStep, number>();
	const docs = hereDocuments(command);
	const variables = new Map<string, string>();
	const helpers = new Set<string>();
	const steps: ExplainedStep[] = [];
	let docIndex = 0;
	const insert = async (
		index: number,
		connector: ExplainedStep["connector"],
		name: string | null,
		line?: string,
	) => {
		const inner = await explainCommand(subs[index] ?? "", loadSpec);
		if (inner.length === 0) return false;
		if (line !== undefined && inner.length === 1 && inner[0])
			inner[0].raw = line;
		inner[0] = {
			...inner[0],
			connector: steps.length > 0 ? connector : null,
		} as ExplainedStep;
		const last = inner.at(-1);
		if (name && last) {
			const remembered: Segment[] = [
				{ text: ", remembering what it prints as " },
				{ code: `$${name}` },
			];
			last.sentence.push(...remembered);
			last.stages?.at(-1)?.sentence.push(...remembered);
		}
		steps.push(...inner);
		return true;
	};
	for (const [index, statement] of statements.entries()) {
		const span = aligned ? spans[index] : undefined;
		let from = span ? inCommand(span.start) : -1;
		const to = span && span.end > span.start ? inCommand(span.end - 1) + 1 : -1;
		let used = 0;
		const line = () =>
			from >= 0 && to > from
				? command.slice(from, to).trim()
				: [
						restore(statement.words.slice(used).map(quote).join(" ")),
						...statement.redirects.map((redirect) =>
							redirect.operator.startsWith("<<")
								? `${redirect.operator}${redirect.target}`
								: `${redirect.operator} ${redirect.target}`,
						),
					]
						.filter(Boolean)
						.join(" ");
		let raw = line();
		const takeLead = (remaining: number) => {
			const until = statement.words.length - remaining;
			const lead = statement.words.slice(used, until);
			used = until;
			let at = from;
			for (const word of lead) {
				if (at < 0) break;
				while (/\s/u.test(command[at] ?? "")) at++;
				at = command.startsWith(word, at) ? at + word.length : -1;
			}
			const written = at >= 0 ? command.slice(from, at).trim() : null;
			from = at;
			raw = line();
			return written ?? lead.join(" ");
		};
		const pushStep = (step: ExplainedStep) => {
			steps.push(step);
			if (from >= 0) starts.set(step, from);
		};
		const headerStep = (lead: string, title: string, ...sentence: Segment[]) =>
			steps.push({
				connector: steps.length > 0 ? connector : null,
				kind: "shell",
				program: "",
				quiet: true,
				raw: lead,
				sentence,
				title,
				words: [],
			});
		const piped = statement.connector === "|";
		const previous = steps.at(-1);
		const connector =
			statement.connector === null || piped
				? null
				: CONNECTORS[statement.connector];
		let words0 = [...statement.words];
		while (words0[0] && BODY_KEYWORDS.has(words0[0])) words0 = words0.slice(1);
		if (words0.length === 0 || CLOSING_KEYWORDS.has(words0[0] ?? "")) continue;
		const captured = capturedSubstitution(words0.join(" "));
		if (captured) {
			if (await insert(captured.index, connector, captured.name, raw)) continue;
		}
		const resolved = words0.map((word) =>
			restore(
				word.replace(
					VARIABLE,
					(whole, name: string) => variables.get(name) ?? whole,
				),
			),
		);
		const quietStep = (title: string, ...sentence: Segment[]) =>
			pushStep({
				connector: steps.length > 0 ? connector : null,
				kind: "shell",
				program: "",
				quiet: true,
				raw,
				sentence,
				title,
				words: [],
			});
		if (resolved.every((word) => ASSIGNMENT.test(word))) {
			for (const word of resolved) {
				const [, name = "", value = ""] = ASSIGNMENT.exec(word) ?? [];
				if (!/\$\(/u.test(value)) variables.set(name, value);
			}
			quietStep(
				"Name a value",
				...resolved.flatMap((word, index): Segment[] => {
					const [, name = "", value = ""] = ASSIGNMENT.exec(word) ?? [];
					return [
						...(index > 0 ? [{ text: ", " }] : []),
						{ code: name },
						{ text: " is " },
						/[/.]/u.test(value) && !/[$`]/u.test(value)
							? { file: value }
							: { code: value },
					];
				}),
			);
			continue;
		}
		let body = resolved;
		const definesHelper =
			body[1] === "()" || /^\w[\w-]*\(\)$/u.test(body[0] ?? "")
				? (body[0] ?? "").replace(/\(\)$/u, "")
				: body[0] === "function"
					? (body[1] ?? "").replace(/\(\)$/u, "")
					: null;
		if (definesHelper) {
			helpers.add(definesHelper);
			body = body.slice(body[0] === "function" || body[1] === "()" ? 2 : 1);
			while (body[0] && BODY_KEYWORDS.has(body[0])) body = body.slice(1);
			headerStep(
				takeLead(body.length),
				"Define a helper",
				{ text: "Define the helper " },
				{ code: definesHelper },
				{ text: ", which runs:" },
			);
			if (body.length === 0) continue;
		}
		if (/^\(?[^()\s]+\)$/u.test(body[0] ?? "")) {
			const pattern = (body[0] ?? "").replace(/^\(|\)$/gu, "");
			body = body.slice(1);
			headerStep(
				takeLead(body.length),
				"If it matches",
				{ text: "If it matches " },
				{ code: pattern },
				{ text: ":" },
			);
			if (body.length === 0) continue;
		}
		if (["while", "until", "if", "elif"].includes(body[0] ?? "")) {
			const negated = body[1] === "!";
			const verb =
				body[0] === "while"
					? "Repeat while"
					: body[0] === "until"
						? "Repeat until"
						: "If";
			body = body.slice(negated ? 2 : 1);
			headerStep(takeLead(body.length), verb, {
				text: `${verb} this ${negated ? "fails" : "succeeds"}:`,
			});
			if (body.length === 0) continue;
		}
		const listed =
			body[0] === "for" || body[0] === "select"
				? substitutionOf(words0.at(-1) ?? "")
				: null;
		if (listed !== null && words0[2] === "in" && words0.length === 4) {
			headerStep(
				takeLead(1),
				"Repeat",
				{ text: "For each " },
				{ code: body[1] ?? "" },
				{ text: " in what this prints:" },
			);
			await insert(listed, "then", null);
			continue;
		}
		if (
			(body[0] === "command" && (body[1] === "-v" || body[1] === "-V")) ||
			body[0] === "type"
		) {
			const names = body
				.slice(body[0] === "type" ? 1 : 2)
				.filter((word) => !word.startsWith("-"));
			pushStep({
				connector: steps.length > 0 ? connector : null,
				kind: "shell",
				program: body[0] ?? "",
				quiet: false,
				raw,
				sentence: [
					{ text: "Check whether " },
					...names.flatMap((name, i): Segment[] => [
						...(i > 0
							? [{ text: i === names.length - 1 ? " and " : ", " }]
							: []),
						{ code: name },
					]),
					{ text: names.length > 1 ? " are installed" : " is installed" },
				],
				title: "Check a program",
				words: [],
			});
			continue;
		}
		const structure = structureStep(body, raw);
		if (structure) {
			pushStep({
				...structure,
				connector: steps.length > 0 ? connector : null,
			});
			continue;
		}
		const { notes, words } = unwrap(body);
		const program = basename(words[0] ?? "");
		if (!program || program.startsWith("-")) continue;
		if (helpers.has(program)) {
			pushStep({
				connector: piped ? "pipe" : connector,
				kind: "shell",
				program,
				quiet: false,
				raw,
				sentence: [
					{ text: "Run the helper " },
					{ code: program },
					...(words.length > 1
						? [{ text: " with " }, { code: words.slice(1).join(" ") }]
						: []),
				],
				title: "Run a helper",
				words: [],
			});
			continue;
		}
		const spec = await loadSpec(program);
		const parsed = spec ? parseArguments(spec, words.slice(1)) : null;
		const readsHereDoc =
			statement.redirects.some((redirect) =>
				redirect.operator.startsWith("<<"),
			) ||
			(statement.words.includes("-") && docIndex < docs.length);
		const output =
			statement.redirects.find(
				(redirect) =>
					redirect.operator === ">" && redirect.target !== "/dev/null",
			)?.target ?? null;
		const context: RuleContext = {
			args: words.slice(1),
			asked: new Set(QUIET_FLAGS),
			hereDoc: readsHereDoc ? (docs[docIndex] ?? null) : null,
			output,
			parsed,
			piped,
			program,
		};
		if (context.hereDoc !== null) docIndex++;
		const filter = piped && previous ? FILTER_RULES[program]?.(context) : null;
		const rule = filter
			? null
			: (versionOrHelp(context) ?? EXPLAIN_RULES[program]?.(context) ?? null);
		const extra = [
			...notes,
			...redirectNotes(statement, rule?.saysOutput ? output : null),
		];
		if (filter && previous) {
			const said = [
				...filter,
				...bracketed([...extra, ...unexplained(context)]),
			];
			previous.stages ??= [
				{ raw: previous.raw, sentence: [...previous.sentence] },
			];
			previous.stages.push({ raw, sentence: said });
			previous.sentence.push({ text: ", " }, ...said);
			const start = starts.get(previous);
			previous.raw =
				start !== undefined && to > start
					? command.slice(start, to).trim()
					: `${previous.raw} | ${raw}`;
			continue;
		}
		const subcommand = parsed?.subcommands.at(-1);
		const fallback = subcommand?.d ?? spec?.d;
		const title =
			rule?.title ??
			(parsed && parsed.subcommands.length > 1
				? parsed.subcommands
						.slice(1)
						.map((sub) => sub.n[0])
						.join(" ")
				: program);
		const sentence: Segment[] =
			rule?.sentence ??
			(fallback
				? [
						{ code: words.join(" ") },
						{ text: `: ${fallback.replace(/\.$/u, "")}` },
					]
				: [{ text: "Run " }, { code: words.join(" ") }]);
		sentence.push(
			...bracketed([
				...extra,
				...(rule ? unexplained(context) : []),
				...alsoNote(rule?.also ?? []),
			]),
		);
		pushStep({
			connector: piped ? "pipe" : connector,
			kind: describeCommand(words.join(" "))?.kind ?? "shell",
			program,
			...(rule?.edits ? { edits: rule.edits } : {}),
			quiet: rule?.quiet ?? false,
			raw,
			sentence,
			title,
			words: parsed ? wordMeanings(parsed.words) : [],
		});
	}
	return steps;
}
