import {
	type Icon,
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
import { OpalChip } from "./session-reader-waterfall-chips";

// A file as a tag: its language's mark on an Opaline pebble in the language's
// own color, then its name, with the whole path on hover.

type FileLanguage = { color: string; Icon: Icon; label: string };

const BY_EXTENSION: Record<string, FileLanguage> = {
	cjs: { color: "#CA8A04", Icon: IconBrandJavascript, label: "JavaScript" },
	css: { color: "#1572B6", Icon: IconBrandCss3, label: "CSS" },
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

function getFileLanguage(name: string): FileLanguage {
	if (/^dockerfile/i.test(name)) return DOCKERFILE;
	const extension = name.includes(".")
		? name.split(".").at(-1)?.toLowerCase()
		: undefined;
	return (extension ? BY_EXTENSION[extension] : undefined) ?? UNKNOWN;
}

export function FileTag({ path }: { path: string }) {
	const name = path.split("/").filter(Boolean).at(-1) ?? path;
	const { color, Icon, label } = getFileLanguage(name);
	return (
		<span
			title={path}
			className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-background pr-2.5 pl-1 shadow-(--custom-outline-shadow) dark:bg-card"
		>
			<OpalChip tint={color} title={label} className="size-4">
				<Icon aria-hidden="true" className="size-2.5" style={{ color }} />
			</OpalChip>
			<span className="truncate font-mono text-xs">{name}</span>
		</span>
	);
}
