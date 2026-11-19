import { lazy, memo, Suspense } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { getSkillDocumentContent } from "../skill-document-content";
import "./rich-skill-document.css";

type RichSkillDocumentVariant = "document" | "preview";

interface RichSkillDocumentProps {
	className?: string;
	content: string;
	variant?: RichSkillDocumentVariant;
}

const SKILL_PREVIEW_MAX_CHARACTERS = 1_200;
const SKILL_LEADING_HEADING_PATTERN = /^#{1,6}[ \t]+[^\r\n]*(?:\r?\n|$)/u;
const MARKDOWN_FENCE_PATTERN = /^```/gmu;

const DOCUMENT_COMPONENTS = createRichSkillDocumentComponents("document");
const PREVIEW_COMPONENTS = createRichSkillDocumentComponents("preview");
const SyntaxHighlightedSkillCode = lazy(() =>
	import("./rich-skill-code-block").then((module) => ({
		default: module.RichSkillCodeBlock,
	})),
);

export const RichSkillDocument = memo(function RichSkillDocument({
	className,
	content,
	variant = "document",
}: RichSkillDocumentProps) {
	return (
		<div
			className={cn("rich-skill-document", className)}
			data-variant={variant}
		>
			<Markdown
				components={
					variant === "preview" ? PREVIEW_COMPONENTS : DOCUMENT_COMPONENTS
				}
				remarkPlugins={[remarkGfm]}
			>
				{skillDocumentMarkdown(content, variant)}
			</Markdown>
		</div>
	);
});

function skillDocumentMarkdown(
	content: string,
	variant: RichSkillDocumentVariant,
): string {
	const withoutFrontmatter = getSkillDocumentContent(content);
	if (variant === "document") {
		return withoutFrontmatter;
	}

	const withoutTitle = withoutFrontmatter
		.replace(SKILL_LEADING_HEADING_PATTERN, "")
		.trim();
	return truncateSkillPreview(withoutTitle);
}

function truncateSkillPreview(markdown: string): string {
	if (markdown.length <= SKILL_PREVIEW_MAX_CHARACTERS) {
		return markdown;
	}

	const initialSlice = markdown.slice(0, SKILL_PREVIEW_MAX_CHARACTERS);
	const lastLineBreak = initialSlice.lastIndexOf("\n");
	const truncated = (
		lastLineBreak >= SKILL_PREVIEW_MAX_CHARACTERS * 0.7
			? initialSlice.slice(0, lastLineBreak)
			: initialSlice
	).trimEnd();
	const fenceCount = truncated.match(MARKDOWN_FENCE_PATTERN)?.length ?? 0;
	const balancedMarkdown =
		fenceCount % 2 === 0 ? truncated : `${truncated}\n\`\`\``;
	return `${balancedMarkdown}\n\n…`;
}

function createRichSkillDocumentComponents(
	variant: RichSkillDocumentVariant,
): Components {
	return {
		a: ({ children, href }) => (
			<a href={href} rel="noreferrer" target="_blank">
				{children}
			</a>
		),
		blockquote: ({ children }) => <blockquote>{children}</blockquote>,
		code: ({ children, className }) => (
			<RichSkillCode
				className={className}
				content={String(children)}
				variant={variant}
			/>
		),
		h1: ({ children }) => <h1>{children}</h1>,
		h2: ({ children }) => <h2>{children}</h2>,
		h3: ({ children }) => <h3>{children}</h3>,
		h4: ({ children }) => <h4>{children}</h4>,
		hr: () => <hr />,
		li: ({ children }) => <li>{children}</li>,
		ol: ({ children }) => <ol>{children}</ol>,
		p: ({ children }) => <p>{children}</p>,
		pre: ({ children }) => <>{children}</>,
		table: ({ children }) => (
			<div className="rich-skill-document__table-scroll">
				<table>{children}</table>
			</div>
		),
		tbody: ({ children }) => <tbody>{children}</tbody>,
		td: ({ children }) => <td>{children}</td>,
		th: ({ children }) => <th>{children}</th>,
		thead: ({ children }) => <thead>{children}</thead>,
		tr: ({ children }) => <tr>{children}</tr>,
		ul: ({ children }) => <ul>{children}</ul>,
	};
}

function RichSkillCode({
	className,
	content,
	variant,
}: {
	className: string | undefined;
	content: string;
	variant: RichSkillDocumentVariant;
}) {
	const languageMatch = /language-([\w-]+)/u.exec(className ?? "");
	const isBlock = languageMatch !== null || content.endsWith("\n");
	if (!isBlock) {
		return <code>{content}</code>;
	}
	const code = content.replace(/\n$/u, "");
	if (variant === "preview") {
		return <PlainSkillCodeBlock content={code} />;
	}

	return (
		<Suspense fallback={<PlainSkillCodeBlock content={code} />}>
			<SyntaxHighlightedSkillCode
				content={code}
				language={languageMatch?.[1] ?? "text"}
			/>
		</Suspense>
	);
}

function PlainSkillCodeBlock({ content }: { content: string }) {
	return (
		<pre className="rich-skill-document__code-block rich-skill-document__plain-code-block">
			<code className="rich-skill-document__code">{content}</code>
		</pre>
	);
}
