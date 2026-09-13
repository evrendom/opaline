import type { CSSProperties } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

const CODE_BLOCK_STYLE: CSSProperties = {
	background: "var(--skill-document-code-background)",
	border: "0.5px solid var(--skill-document-code-border)",
	borderRadius: "8px",
	boxShadow: "inset 0 0 0 1px var(--skill-document-code-highlight)",
	fontFamily:
		'"SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
	fontSize: "inherit",
	lineHeight: "inherit",
	margin: "12px 0 14px",
	overflow: "auto",
	padding: "14px 16px",
	tabSize: 2,
};

export function RichSkillCodeBlock({
	content,
	language,
}: {
	content: string;
	language: string;
}) {
	return (
		<SyntaxHighlighter
			className="rich-skill-document__code-block"
			codeTagProps={{ className: "rich-skill-document__code" }}
			customStyle={CODE_BLOCK_STYLE}
			language={language}
			PreTag="pre"
			style={oneLight}
		>
			{content}
		</SyntaxHighlighter>
	);
}
