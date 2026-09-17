import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

export const TEAM_INVITE_IMAGE_WIDTH = 2400;
export const TEAM_INVITE_IMAGE_HEIGHT = 1260;
const FONT_PATH = fileURLToPath(
	new URL("../assets/team-invite/InterVariable.ttf", import.meta.url),
);
const FONT_OPTIONS = {
	fontFiles: [FONT_PATH],
	defaultFontFamily: "Inter Variable",
	loadSystemFonts: false,
};
const WORDMARK = readFileSync(
	new URL("../assets/team-invite/opaline-wordmark.svg", import.meta.url),
	"utf8",
).replace(/<svg\b[^>]*>|<\/svg>/gu, "");
const images = new Map<string, Buffer>();

export function renderTeamInviteCardPng(workspaceName: string): Buffer {
	const cached = images.get(workspaceName);
	if (cached) return cached;
	const image = new Resvg(buildTeamInviteCardSvg(workspaceName), {
		font: FONT_OPTIONS,
	})
		.render()
		.asPng();
	if (images.size >= 32) {
		const oldest = images.keys().next().value;
		if (oldest !== undefined) images.delete(oldest);
	}
	images.set(workspaceName, image);
	return image;
}

export function buildTeamInviteCardSvg(workspaceName: string): string {
	return buildBrandCardSvg(wrapTitle(`Join ${workspaceName}`), [
		"and start learning from",
		"your agent sessions",
	]);
}

export function renderSiteCardPng(): Buffer {
	return new Resvg(
		buildBrandCardSvg(["Claude Code & Codex", "Session Analytics"], []),
		{
			font: FONT_OPTIONS,
		},
	)
		.render()
		.asPng();
}

function buildBrandCardSvg(title: string[], subtitle: string[]): string {
	const titleFontSize = fitTitleFontSize(title);
	const firstLineY = 256 - (title.length - 1) * 34;
	const subtitleY = firstLineY + (title.length - 1) * 74 + 70;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${TEAM_INVITE_IMAGE_WIDTH}" height="${TEAM_INVITE_IMAGE_HEIGHT}" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fdfdfc"/>
  <svg x="76" y="68" width="144" height="36" viewBox="0 0 64 16">${WORDMARK}</svg>
  <g font-family="Inter Variable, sans-serif" fill="#171717">
    ${title.map((line, index) => `<text x="76" y="${firstLineY + index * 74}" font-size="${titleFontSize}" font-weight="600" letter-spacing="-2">${escapeSvgText(line)}</text>`).join("\n    ")}
    ${subtitle.map((line, index) => `<text x="76" y="${subtitleY + index * 52}" font-size="40" font-weight="400" fill="#737373">${escapeSvgText(line)}</text>`).join("\n    ")}
    <text x="76" y="562" font-size="23" font-weight="500" fill="#737373">opaline.so</text>
  </g>
</svg>`;
}

function fitTitleFontSize(lines: string[]): number {
	const measurement = new Resvg(
		`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="400">${lines.map((line, index) => `<text y="${80 + index * 80}" font-family="Inter Variable" font-size="64" font-weight="600" letter-spacing="-2">${escapeSvgText(line)}</text>`).join("")}</svg>`,
		{ font: FONT_OPTIONS },
	);
	const width = measurement.innerBBox()?.width ?? 0;
	return width > 1048 ? Math.floor((64 * 1048) / width) : 64;
}

function wrapTitle(value: string): string[] {
	const characters = Array.from(
		value
			.replace(/[\p{Cc}\p{Cf}]/gu, " ")
			.replace(/\s+/gu, " ")
			.trim(),
	);
	const lines: string[] = [];
	while (characters.length && lines.length < 3) {
		let length = Math.min(28, characters.length);
		const lastSpace = characters.slice(0, length + 1).lastIndexOf(" ");
		if (characters.length > length && lastSpace > 8) length = lastSpace;
		let line = characters.splice(0, length).join("").trim();
		while (characters[0] === " ") characters.shift();
		if (lines.length === 2 && characters.length) line += "…";
		lines.push(line);
	}
	return lines;
}

function escapeSvgText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
