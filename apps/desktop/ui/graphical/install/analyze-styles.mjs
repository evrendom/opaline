// Analyzes the Mac app's styles for Graphical. Run from apps/desktop/ui:
//   node graphical/install/analyze-styles.mjs
import { writeFile } from "node:fs/promises";
import { analyzeAppStyles } from "@graphical/editor/analyze-styles";

// Data and artwork paint: charts, the session constellation and activity
// lanes, model and usage tones, the opal sheen and avatar art. They carry
// meaning, not the interface's design.
const DATA_PAINT =
	/(chart|graph|constellation|activity-strip|utilization|model-badge|model-icon|shell-nav-icon|opal|avatar|skill-mark|glyph|waterfall|heat|step-lanes|minimap|thread-overview-event-dots|activity-tag)/i;

// Owners the analyzer can't trace, reviewed by hand. Each stays as authored.
const REVIEWED = [
	[/^src\/app\/ui\/table\.tsx$/, "Column alignment classes only; no theme values."],
	[/^src\/app\/ui\/calendar\.tsx$/, "react-day-picker's own default class names; no theme values."],
	[/^src\/features\/sessions\/reader\/reader-dom\.ts$/, "Layout state variants only; no theme values."],
	[/^src\/components\/conversation\/CodeBlock\.tsx$/, "Language brand colours on code headers: artwork."],
	[/^src\/components\/pierre\/diff-view\.tsx$/, "Diff addition and removal marks: content colours."],
	[/^src\/features\/compass\/run-lanes-model\.ts$/, "Run lane colours: data paint."],
	[/^src\/features\/sessions\/reader\/model\/session-reader-model\.ts$/, "Cost heat scale, cheapest to priciest: data paint."],
	[/^src\/features\/sessions\/reader\/rail\/session-reader-turn-rail-row\.tsx$/, "Reads the cost heat scale: data paint."],
	[/^src\/features\/sessions\/reader\/detail\/waterfall\//, "Waterfall bar and CI tones: data paint."],
	[/^src\/features\/shell\/config\/shell-routes\.tsx$/, "Opal nav chip tones: brand artwork."],
	[/^src\/features\/sessions\/reader\/ci\/session-reader-ci-rounds-view\.tsx$/, "CI outcome icons are Tabler components beside status classes; the classes are converted."],
	[/^src\/features\/repos\/repo-reader\/repo-page-kit\.tsx$/, "Sentiment chip tones keyed by name and typed from the map; kept as authored for this import."],
	// cn() merges with tailwind-merge extended by Graphical's classes
	// (graphical/generated/tailwind-merge.cjs). The analyzer can't follow the
	// extended merger, so it can't place the class constants cn() reads. They
	// were converted by the install.
	[/^src\/lib\/utils\.ts$/, "cn() is clsx with tailwind-merge extended by Graphical's classes."],
	...[
		"src/components/conversation/conversation-trace-class-names.ts",
		"src/components/conversation/expandable-trace-row.tsx",
		"src/features/sessions/components/sessions-overview-table-utils.ts",
		"src/features/repos/repo-skill-page.tsx",
		"src/features/sessions/components/session-overview-row-elements.tsx",
		"src/components/overview-list.tsx",
		"src/features/sessions/components/session-detail-header.tsx",
		"src/features/sessions/components/session-interaction-counts.tsx",
		"src/features/sessions/components/session-model-mark.tsx",
		"src/features/sessions/reader/session-reader-tabs.tsx",
		"src/features/sessions/reader/detail/reading-measure.ts",
		"src/features/sessions/reader/detail/step/session-reader-command-steps.tsx",
		"src/features/team/components/TeamMemberOverviewTable.tsx",
	].map((path) => [
		new RegExp(`^${path.replaceAll(".", "\\.")}$`),
		"Class constants read through cn(), which the analyzer can't follow once tailwind-merge is extended; converted by the install.",
	]),
];

const inventory = await analyzeAppStyles({
	root: process.cwd(),
	roots: ["src"],
	appName: "Opaline",
	tailwind: true,
	exclude: [
		// The marketing website: conversion is for the app first.
		/^src\/site\//,
		// Development-only tools and test support.
		/^src\/dev\//,
		/^src\/test\//,
		/\.bun-test\.[cm]?[jt]sx?$/,
	],
	classify({ path, text }) {
		if (DATA_PAINT.test(path)) return { preserve: true };
		// Content colours: a language's brand colour on code headers, white
		// labels on coloured bars and buttons, the code surface's P3 colours.
		if (
			/#3178c6/i.test(text) ||
			(path.endsWith("compass-run-lanes.tsx") && /\btext-white\b/.test(text)) ||
			(path.endsWith("cli-onboarding.css") && /color:\s*white/.test(text)) ||
			(path.endsWith("code-block.css") && /display-p3/.test(text))
		) {
			return { preserve: true };
		}
		return {};
	},
	reviewCoverage(issue) {
		return REVIEWED.find(([pattern]) => pattern.test(issue.path))?.[1];
	},
});

await writeFile(
	new URL("./style-inventory.json", import.meta.url),
	JSON.stringify(inventory),
);
const unreviewed = inventory.coverage.filter((issue) => !issue.reviewed);
console.log(
	`analyzed ${Object.keys(inventory.files).length} files; coverage: ${inventory.coverage.length}, unreviewed: ${unreviewed.length}`,
);
for (const issue of unreviewed) console.log(`  ${issue.path}:${issue.line ?? ""} ${issue.detail}`);
