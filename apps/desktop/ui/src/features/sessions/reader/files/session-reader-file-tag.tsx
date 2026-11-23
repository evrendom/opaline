import {
	type Icon,
	IconBrandAstro,
	IconBrandCss3,
	IconBrandDocker,
	IconBrandGolang,
	IconBrandHtml5,
	IconBrandJavascript,
	IconBrandKotlin,
	IconBrandPhp,
	IconBrandPython,
	IconBrandReact,
	IconBrandRust,
	IconBrandSass,
	IconBrandSwift,
	IconBrandTypescript,
	IconClipboardText,
	IconFile,
	IconFileText,
	IconJson,
	IconLock,
	IconMarkdown,
	IconPhoto,
	IconSettings,
	IconSql,
	IconTerminal2,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { OpalChip } from "../detail/waterfall/session-reader-waterfall-chips";
import { isPastedText } from "../model/session-reader-step-lanes";
import { SessionFileLink } from "./session-file-link";

// A file as a tag: its language's mark on an Opaline pebble in the language's
// own color, then its name, with the whole path on hover.

type FileLanguage = { color: string; Icon: Icon; label: string };

const BY_EXTENSION: Record<string, FileLanguage> = {
	astro: { color: "#BC52EE", Icon: IconBrandAstro, label: "Astro" },
	cjs: { color: "#CA8A04", Icon: IconBrandJavascript, label: "JavaScript" },
	// design-escape-ok(base): data paint; a category colour from the opal sheen
	css: { color: "var(--color-1)", Icon: IconBrandCss3, label: "CSS" },
	cts: { color: "#3178C6", Icon: IconBrandTypescript, label: "TypeScript" },
	go: { color: "#00ADD8", Icon: IconBrandGolang, label: "Go" },
	html: { color: "#E34F26", Icon: IconBrandHtml5, label: "HTML" },
	jpeg: { color: "#D97706", Icon: IconPhoto, label: "Image" },
	jpg: { color: "#D97706", Icon: IconPhoto, label: "Image" },
	js: { color: "#CA8A04", Icon: IconBrandJavascript, label: "JavaScript" },
	json: { color: "#CA8A04", Icon: IconJson, label: "JSON" },
	jsonc: { color: "#CA8A04", Icon: IconJson, label: "JSON" },
	jsonl: { color: "#CA8A04", Icon: IconJson, label: "JSON Lines" },
	jsx: { color: "#149ECA", Icon: IconBrandReact, label: "React" },
	kt: { color: "#7F52FF", Icon: IconBrandKotlin, label: "Kotlin" },
	lock: { color: "#64748B", Icon: IconLock, label: "Lockfile" },
	md: { color: "#64748B", Icon: IconMarkdown, label: "Markdown" },
	mdx: { color: "#64748B", Icon: IconMarkdown, label: "MDX" },
	mjs: { color: "#CA8A04", Icon: IconBrandJavascript, label: "JavaScript" },
	mts: { color: "#3178C6", Icon: IconBrandTypescript, label: "TypeScript" },
	php: { color: "#777BB4", Icon: IconBrandPhp, label: "PHP" },
	png: { color: "#D97706", Icon: IconPhoto, label: "Image" },
	py: { color: "#3776AB", Icon: IconBrandPython, label: "Python" },
	rs: { color: "#CE422B", Icon: IconBrandRust, label: "Rust" },
	sass: { color: "#CC6699", Icon: IconBrandSass, label: "Sass" },
	scss: { color: "#CC6699", Icon: IconBrandSass, label: "Sass" },
	sh: { color: "#4EAA25", Icon: IconTerminal2, label: "Shell" },
	sql: { color: "#336791", Icon: IconSql, label: "SQL" },
	svg: { color: "#D97706", Icon: IconPhoto, label: "SVG" },
	swift: { color: "#F05138", Icon: IconBrandSwift, label: "Swift" },
	toml: { color: "#64748B", Icon: IconSettings, label: "TOML" },
	ts: { color: "#3178C6", Icon: IconBrandTypescript, label: "TypeScript" },
	tsx: { color: "#149ECA", Icon: IconBrandReact, label: "React" },
	txt: { color: "#64748B", Icon: IconFileText, label: "Text" },
	webp: { color: "#D97706", Icon: IconPhoto, label: "Image" },
	yaml: { color: "#64748B", Icon: IconSettings, label: "YAML" },
	yml: { color: "#64748B", Icon: IconSettings, label: "YAML" },
	zsh: { color: "#4EAA25", Icon: IconTerminal2, label: "Shell" },
};

const DOCKERFILE: FileLanguage = {
	color: "#2496ED",
	Icon: IconBrandDocker,
	label: "Dockerfile",
};
const UNKNOWN: FileLanguage = {
	color: "#64748B",
	Icon: IconFile,
	label: "File",
};

const PASTED: FileLanguage = {
	color: "#737373",
	Icon: IconClipboardText,
	label: "Pasted text",
};
export function getFileLanguage(name: string): FileLanguage {
	if (/^dockerfile/i.test(name)) return DOCKERFILE;
	if (isPastedText(name)) return PASTED;
	const extension = name.includes(".")
		? name.split(".").at(-1)?.toLowerCase()
		: undefined;
	return (extension ? BY_EXTENSION[extension] : undefined) ?? UNKNOWN;
}

export function FileTag({
	className,
	path,
}: {
	className?: string;
	path: string;
}) {
	const name = path.split("/").filter(Boolean).at(-1) ?? path;
	const { color, Icon } = getFileLanguage(name);
	return (
		<SessionFileLink path={path} className={cn("inline-flex", className)}>
			<span
				title={path}
				className={cn(
					"inline-flex h-6 max-w-full min-w-0 items-center gap-s",
					"corner-full pr-l pl-xs",
					"bg-surface shadow-card",
					className,
				)}
			>
				<OpalChip tint={color} className="size-4">
					<Icon aria-hidden="true" className="size-2.5" style={{ color }} />
				</OpalChip>
				<span className="truncate font-mono text-body-m">{name}</span>
			</span>
		</SessionFileLink>
	);
}
