import type { CSSProperties } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/app/providers/ThemeProvider";

const CODE_BLOCK_STYLE: CSSProperties = {
	background: "var(--inset)",
	border: "var(--border-s) solid var(--line)",
	borderRadius: "var(--radius-s)",
	boxShadow: "inset 0 0 0 1px var(--skill-document-code-highlight)",
	fontFamily: "var(--font-data)",
	fontSize: "inherit",
	lineHeight: "inherit",
	margin: "var(--space-l) var(--space-zero) var(--space-xl)",
	overflow: "auto",
	padding: "var(--space-xl) var(--space-xl)",
	tabSize: 2,
};

export function RichSkillCodeBlock({
	content,
	language,
}: {
	content: string;
	language: string;
}) {
	const { resolvedTheme } = useTheme();
	return (
		<SyntaxHighlighter
			className="rich-skill-document__code-block"
			codeTagProps={{ className: "rich-skill-document__code" }}
			customStyle={CODE_BLOCK_STYLE}
			language={language}
			PreTag="pre"
			style={resolvedTheme === "dark" ? oneDark : oneLight}
		>
			{content}
		</SyntaxHighlighter>
	);
}
