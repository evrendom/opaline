import { Fragment, useMemo } from "react";
import { getSkillDocumentContent } from "@/features/skills/skill-document-content";
import { cn } from "@/lib/utils";

type Block =
	| { type: "heading"; level: number; text: string }
	| { type: "paragraph"; lines: string[] }
	| { type: "list"; ordered: boolean; items: string[] }
	| { type: "tag"; text: string }
	| { type: "code"; lines: string[] }
	| { type: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/u;
const BULLET = /^\s*[-*•]\s+(.*)$/u;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/u;
const TAG = /^<\/?[A-Za-z_][\w:-]*(?:\s[^<>]*)?>$/u;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/u;
const FENCE = /^```/u;

function isSpecial(line: string): boolean {
	return (
		line.trim() === "" ||
		HEADING.test(line) ||
		RULE.test(line) ||
		TAG.test(line.trim()) ||
		FENCE.test(line) ||
		BULLET.test(line) ||
		ORDERED.test(line)
	);
}

function parseSetupText(text: string): Block[] {
	const blocks: Block[] = [];
	const lines = text.replace(/\r\n?/gu, "\n").split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] as string;
		if (line.trim() === "") {
			i++;
			continue;
		}
		if (FENCE.test(line)) {
			const code: string[] = [];
			i++;
			while (i < lines.length && !FENCE.test(lines[i] as string)) {
				code.push(lines[i] as string);
				i++;
			}
			i++;
			blocks.push({ lines: code, type: "code" });
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({
				level: (heading[1] as string).length,
				text: heading[2] as string,
				type: "heading",
			});
			i++;
			continue;
		}
		if (RULE.test(line)) {
			blocks.push({ type: "rule" });
			i++;
			continue;
		}
		if (TAG.test(line.trim())) {
			blocks.push({ text: line.trim(), type: "tag" });
			i++;
			continue;
		}
		if (BULLET.test(line) || ORDERED.test(line)) {
			const ordered = ORDERED.test(line);
			const pattern = ordered ? ORDERED : BULLET;
			const items: string[] = [];
			while (i < lines.length) {
				const item = pattern.exec(lines[i] as string);
				if (!item) break;
				items.push(item[1] as string);
				i++;
			}
			blocks.push({ items, ordered, type: "list" });
			continue;
		}
		const paragraph: string[] = [];
		while (i < lines.length && !isSpecial(lines[i] as string)) {
			paragraph.push(lines[i] as string);
			i++;
		}
		blocks.push({ lines: paragraph, type: "paragraph" });
	}
	return blocks;
}

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/gu;

function Inline({ text }: { text: string }) {
	const parts = text.split(INLINE);
	return (
		<>
			{parts.map((part, index) => {
				const key = `${index}:${part}`;
				if (index % 2 === 0) return <Fragment key={key}>{part}</Fragment>;
				if (part.startsWith("**"))
					return (
						<strong key={key} className="font-heavy">
							{part.slice(2, -2)}
						</strong>
					);
				return (
					<code
						key={key}
						// design-escape-ok(type,radius): shipped value; code at 0.85em of its prose, 4px corners
						className="rounded-[4px] bg-field px-xs py-[calc(var(--space-xxs)/2)] font-mono text-[0.85em]"
					>
						{part.slice(1, -1)}
					</code>
				);
			})}
		</>
	);
}

export function SetupProse({
	className,
	text,
}: {
	className?: string;
	text: string;
}) {
	const blocks = useMemo(
		() => parseSetupText(getSkillDocumentContent(text)),
		[text],
	);
	return (
		<div
			data-selectable=""
			className={cn(
				// design-escape-ok(type): shipped value; 13/21.125 prose
				"flex flex-col gap-[calc(var(--space-m)+var(--space-xxs))] text-[13px] leading-relaxed [overflow-wrap:anywhere]",
				className,
			)}
		>
			{blocks.map((block, index) => {
				const key = `${index}:${block.type}`;
				switch (block.type) {
					case "heading":
						return (
							<div
								key={key}
								className={cn(
									"font-heavy text-balance",
									// design-escape-ok(type): shipped value; 13px on the prose's line
									block.level <= 2 ? "mt-xs text-body-xl" : "text-[13px]",
								)}
							>
								<Inline text={block.text} />
							</div>
						);
					case "paragraph":
						return (
							<p key={key}>
								{block.lines.map((line, at) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: a text's lines are fixed; the same line can repeat, so its place keys it
									<Fragment key={`${at}:${line}`}>
										{at > 0 ? <br /> : null}
										<Inline text={line} />
									</Fragment>
								))}
							</p>
						);
					case "list": {
						const List = block.ordered ? "ol" : "ul";
						return (
							<List
								key={key}
								className={cn(
									// design-escape-ok(opacity): shipped value; muted-foreground/70
									"space-y-xxs pl-[calc(var(--space-xl)+var(--space-xs))] marker:text-ink-3/70",
									block.ordered ? "list-decimal" : "list-disc",
								)}
							>
								{block.items.map((item, at) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: a list's items are fixed; the same item can repeat, so its place keys it
									<li key={`${at}:${item}`} className="pl-xxs">
										<Inline text={item} />
									</li>
								))}
							</List>
						);
					}
					case "code":
						return (
							<pre
								key={key}
								// design-escape-ok(type): shipped value; 11/20
								className="overflow-x-auto corner-s bg-field px-l py-m font-mono text-[11px]/5"
							>
								{block.lines.join("\n")}
							</pre>
						);
					case "tag":
						return (
							<div key={key} className="font-mono text-body-s text-ink-3">
								{block.text}
							</div>
						);
					case "rule":
						// design-escape-ok(opacity): shipped value; border/60
						return <hr key={key} className="border-line-strong/60" />;
					default:
						return null;
				}
			})}
		</div>
	);
}
