import type {
	ExplainedStep,
	FileEdit,
	Segment,
} from "@rudel/api-routes/command-glossary";
import { IconBubbleText, IconCode } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { FileTag } from "../../files/session-reader-file-tag";
import { explainCommandQuery } from "./explain-command-query";
import { HeredocBodies } from "./session-reader-heredocs";
import {
	alternativesIn,
	leadingSpaces,
	orSyntax,
	type Piece,
	type Span,
	stageSpans,
	substitutionIn,
	tokenColor,
	wordsOf,
} from "./session-reader-shell-layout";
import { useShellHighlight } from "./session-reader-step-payloads";

function keyed<T>(
	items: readonly T[],
	say: (item: T) => string,
): { item: T; key: string }[] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const text = say(item);
		const count = seen.get(text) ?? 0;
		seen.set(text, count + 1);
		return { item, key: `${text}#${count}` };
	});
}

const segmentText = (segment: Segment) =>
	"file" in segment
		? segment.file
		: "term" in segment
			? segment.term
			: "code" in segment
				? segment.code
				: segment.text;

const hasName = (path: string) =>
	!/[$`]/u.test(path) &&
	!/^(?:\.{1,2}|~)$/u.test(path.split("/").filter(Boolean).at(-1) ?? "");

const WHOLE = "inline-block max-w-full indent-0 [overflow-wrap:anywhere]";
const CHIP = cn(WHOLE, "corner-xs bg-field px-xs py-xxs text-ink");

function SegmentView({ color, segment }: { color?: string; segment: Segment }) {
	const style = color ? { color } : undefined;
	if ("file" in segment)
		return hasName(segment.file) ? (
			<FileTag className="align-middle" path={segment.file} />
		) : (
			<code style={style} className={cn(CHIP, "font-mono text-body-m")}>
				{segment.file}
			</code>
		);
	if ("term" in segment)
		return (
			<span
				style={style}
				className={cn(
					WHOLE,
					"font-medium text-ink [font-variant-ligatures:none] [font-feature-settings:'calt'_0]",
				)}
			>
				“<Indented text={segment.term} />”
			</span>
		);
	if ("code" in segment)
		return (
			<code style={style} className={cn(CHIP, "font-mono text-body-m")}>
				{segment.code}
			</code>
		);
	return <>{segment.text}</>;
}

function gluePunctuation(
	segments: readonly Segment[],
): { segment: Segment; tail?: string }[] {
	const parts: { segment: Segment; tail?: string }[] = [];
	for (const segment of segments) {
		const previous = parts.at(-1);
		if ("text" in segment && previous && !("text" in previous.segment)) {
			const tail = /^[^\s]+/u.exec(segment.text)?.[0] ?? "";
			if (tail) previous.tail = (previous.tail ?? "") + tail;
			const rest = segment.text.slice(tail.length);
			if (rest) parts.push({ segment: { ...segment, text: rest } });
			continue;
		}
		parts.push({ segment });
	}
	return parts;
}

function GluedSegment({
	lines,
	part,
}: {
	lines: Parameters<typeof tokenColor>[0];
	part: { segment: Segment; tail?: string };
}) {
	const { segment } = part;
	const view = (
		<SegmentView
			color={
				"text" in segment ? undefined : tokenColor(lines, segmentText(segment))
			}
			segment={segment}
		/>
	);
	return part.tail ? (
		<span className="whitespace-nowrap">
			{view}
			{part.tail}
		</span>
	) : (
		view
	);
}

const stagesOf = (step: ExplainedStep) =>
	step.stages ?? [{ raw: step.raw, sentence: step.sentence }];

const filesNamed = (sentence: readonly Segment[]) =>
	new Set(
		sentence.flatMap((segment) =>
			"file" in segment && hasName(segment.file) ? [segment.file] : [],
		),
	);

const unquoted = (word: string) => word.replace(/^(["'])(.*)\1$/su, "$2");

function Words({
	files,
	words,
}: {
	files: ReadonlySet<string>;
	words: Piece[][];
}) {
	return keyed(words, (word) => word.map((piece) => piece.text).join("")).map(
		({ item, key }, index) => {
			const text = unquoted(item.map((piece) => piece.text).join(""));
			return (
				<span key={key}>
					{index > 0 ? (
						item[0]?.spaces ? (
							<Spaces count={item[0].spaces} />
						) : (
							" "
						)
					) : null}
					{files.has(text) ? (
						<FileTag className="align-middle" path={text} />
					) : (
						<Letters pieces={item} />
					)}
				</span>
			);
		},
	);
}

function Letters({ pieces }: { pieces: Piece[] }) {
	return (
		<span className={WHOLE}>
			{keyed(pieces, (piece) => piece.text).map((piece) =>
				piece.item.mark ? (
					<QuoteMark key={piece.key} piece={piece.item} />
				) : (
					<span
						key={piece.key}
						style={piece.item.color ? { color: piece.item.color } : undefined}
					>
						{keyed(piece.item.text.split("\\|"), (part) => part).map(
							({ item, key }, index) => (
								<span key={key}>
									{index > 0 ? <OrSign /> : null}
									{item}
								</span>
							),
						)}
					</span>
				),
			)}
		</span>
	);
}

function QuoteMark({ piece }: { piece: Piece }) {
	const double = piece.text === '"';
	return (
		<span className="text-ink-disabled">
			{piece.mark === "open" ? (double ? "“" : "‘") : double ? "”" : "’"}
		</span>
	);
}

function Sign({ title, word }: { title: string; word: string }) {
	return (
		<span
			title={title}
			className={cn(
				"inline-block",
				"mx-xxs corner-xs px-xs",
				"align-[1px] font-body text-body-xs font-medium",
				"bg-field text-ink-3",
			)}
		>
			{word}
		</span>
	);
}

const OrSign = () => <Sign title="\| — either side matches" word="or" />;

const OPERATOR: Partial<
	Record<NonNullable<ExplainedStep["connector"]>, string>
> = { and: "&&", or: "||", pipe: "|" };

const OPERATOR_SIGN: Record<string, { title: string; word: string }> = {
	"&&": { title: "&& — runs only if the one before worked", word: "and" },
	"|": { title: "| — gets the output of the one before", word: "into" },
	"||": { title: "|| — runs only if the one before failed", word: "or else" },
};

function capitalized(sentence: readonly Segment[]): Segment[] {
	const [first, ...rest] = sentence;
	if (!first || !("text" in first)) return [...sentence];
	return [
		{
			...first,
			text: first.text.charAt(0).toUpperCase() + first.text.slice(1),
		},
		...rest,
	];
}

function StageText({
	lines,
	open,
	raw,
	sentence,
	span,
}: {
	lines: Parameters<typeof tokenColor>[0];
	open: boolean;
	raw: string;
	sentence: readonly Segment[];
	span: Span;
}) {
	return open ? (
		// design-escape-ok(opacity): no role renders this; text-ink/80">
		<span className="text-body-l text-ink/80">
			{keyed(gluePunctuation(capitalized(sentence)), (part) =>
				segmentText(part.segment),
			).map(({ item, key }) => (
				<GluedSegment key={key} lines={lines} part={item} />
			))}
		</span>
	) : (
		<CommandText
			files={filesNamed(sentence)}
			lines={lines}
			raw={raw}
			span={span}
		/>
	);
}

const NO_FILES: ReadonlySet<string> = new Set();

function CommandText({
	files,
	lines,
	raw,
	span,
}: {
	files: ReadonlySet<string>;
	lines: Parameters<typeof tokenColor>[0];
	raw: string;
	span: Span;
}) {
	const words = (part: Span, named = files) => (
		<Words files={named} words={wordsOf(raw, lines, part)} />
	);
	const substitution = substitutionIn(raw, span);
	if (substitution) {
		const { find, flags, quoted, replace } = substitution;
		const open = words(
			{ end: quoted.start + 1, start: quoted.start },
			NO_FILES,
		);
		const close = words({ end: quoted.end, start: quoted.end - 1 }, NO_FILES);
		return (
			<code className="font-mono text-body-m">
				{words({ end: quoted.start, start: span.start })}{" "}
				<span className={WHOLE}>
					{open}
					{words(find, NO_FILES)}
					{close}
				</span>
				<Sign
					title="s/…/…/ — what it finds, with what it puts instead"
					word="with"
				/>
				<span className={WHOLE}>
					{open}
					{words(replace, NO_FILES)}
					{close}
				</span>
				{flags.end > flags.start ? <> {words(flags, NO_FILES)}</> : null}{" "}
				{words({ end: span.end, start: quoted.end })}
			</code>
		);
	}
	const [pattern] = alternativesIn(raw, span, orSyntax(raw, span));
	if (!pattern)
		return <code className="font-mono text-body-m">{words(span)}</code>;
	const { alternatives, quoted } = pattern;
	const openQuote = words(
		{ end: quoted.start + 1, start: quoted.start },
		NO_FILES,
	);
	const closeQuote = words(
		{ end: quoted.end, start: quoted.end - 1 },
		NO_FILES,
	);
	return (
		<code className="font-mono text-body-m">
			{words({ end: quoted.start, start: span.start })}
			<span className="block pl-[2ch]">
				{keyed(alternatives, (part) => raw.slice(part.start, part.end)).map(
					({ item, key }, index) => {
						const lead = leadingSpaces(raw, item);
						return (
							<span key={key} className="flex items-baseline">
								<span
									aria-hidden={index === 0 ? true : undefined}
									className={cn("shrink-0", index === 0 && "invisible")}
								>
									<OrSign />
								</span>
								<span className="min-w-0">
									{openQuote}
									{lead > 0 ? <Spaces count={lead} /> : null}
									{words({ end: item.end, start: item.start + lead }, NO_FILES)}
									{closeQuote}
								</span>
							</span>
						);
					},
				)}
			</span>
			{words({ end: span.end, start: quoted.end })}
		</code>
	);
}

function Indented({ text }: { text: string }) {
	return keyed(text.split(/(^ +| {2,})/u), (part) => part).map(
		({ item, key }) =>
			/^ +$/u.test(item) && (item.length > 1 || text.startsWith(item)) ? (
				<Spaces key={key} count={item.length} />
			) : (
				<span key={key}>{item}</span>
			),
	);
}

function Spaces({ count }: { count: number }) {
	return (
		<span
			title={`${count} space${count === 1 ? "" : "s"}`}
			className="text-ink-3/50 select-none"
		>
			{"·".repeat(count)}
		</span>
	);
}

function WordsButton({
	onToggle,
	open,
}: {
	onToggle: () => void;
	open: boolean;
}) {
	const label = open ? "Show the command" : "Read in plain words";
	const Icon = open ? IconCode : IconBubbleText;
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={open}
			title={label}
			onClick={onToggle}
			className={cn(
				"inline-flex size-5 shrink-0 items-center justify-center",
				"ml-auto corner-xs",
				"text-ink-3/60 transition-colors",
				"hover:bg-hover hover:text-ink",
				open && "bg-field text-ink",
			)}
		>
			<Icon aria-hidden="true" className="size-3.5" />
		</button>
	);
}

function StepRows({
	first,
	isOpen,
	onToggle,
	plainWords,
	step,
}: {
	first: boolean;
	plainWords: boolean;
	isOpen: (stage: number) => boolean;
	onToggle: (stage: number) => void;
	step: ExplainedStep;
}) {
	const highlight = useShellHighlight(step.raw);
	const stages = stagesOf(step);
	const spans = stageSpans(
		step.raw,
		stages.map((stage) => stage.raw),
	);
	const rows = spans
		? stages.map((stage, index) => ({
				sentence: stage.sentence,
				span: spans[index] ?? { end: step.raw.length, start: 0 },
			}))
		: [{ sentence: step.sentence, span: { end: step.raw.length, start: 0 } }];
	const operator = first || !step.connector ? null : OPERATOR[step.connector];
	return (
		<li className="flex flex-col gap-xs py-s">
			{keyed(rows, (row) => step.raw.slice(row.span.start, row.span.end)).map(
				({ item, key }, index) => {
					const mark = index === 0 ? operator : "|";
					return (
						<div key={key} className="flex min-w-0 items-baseline gap-s">
							{mark && OPERATOR_SIGN[mark] ? (
								<span className="shrink-0">
									<Sign {...OPERATOR_SIGN[mark]} />
								</span>
							) : null}
							<div className="min-w-0 flex-1">
								<StageText
									lines={highlight?.lines}
									open={isOpen(index)}
									raw={step.raw}
									sentence={item.sentence}
									span={item.span}
								/>
							</div>
							{plainWords ? (
								<WordsButton
									onToggle={() => onToggle(index)}
									open={isOpen(index)}
								/>
							) : null}
						</div>
					);
				},
			)}
		</li>
	);
}

export function CommandLines({
	command,
	fallback,
	plainWords = false,
	renderEdit,
}: {
	command: string;
	fallback?: ReactNode;
	plainWords?: boolean;
	renderEdit?: (edit: FileEdit) => ReactNode;
}) {
	const explained = useQuery(explainCommandQuery(command));
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	if (explained.isPending) return null;
	const steps = explained.data ?? [];
	if (steps.length === 0) return fallback ?? null;
	const edits = steps.flatMap((step) => step.edits ?? []);
	const toggle = (row: string) =>
		setOpen((current) => {
			const next = new Set(current);
			if (!next.delete(row)) next.add(row);
			return next;
		});
	return (
		<div className="flex flex-col gap-m">
			<ul
				className={cn(
					"flex flex-col",
					"divide-y corner-m edge-m px-m py-xxs",
					"divide-line-soft border-line-soft bg-canvas",
					"dark:bg-canvas/25",
				)}
			>
				{keyed(steps, (step) => step.raw).map(({ item, key }, index) => (
					<StepRows
						key={key}
						first={index === 0}
						plainWords={plainWords}
						isOpen={(stage) => open.has(`${key}:${stage}`)}
						onToggle={(stage) => toggle(`${key}:${stage}`)}
						step={item}
					/>
				))}
			</ul>
			<HeredocBodies command={command} />
			{renderEdit
				? keyed(edits, (edit) => edit.file).map(({ item, key }) => (
						<div key={key}>{renderEdit(item)}</div>
					))
				: null}
		</div>
	);
}
