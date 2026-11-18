import { Fragment, type ReactNode } from "react";
import "./announcement.css";

// Reference copy from the pulled design; replace with Opaline's own announcement.
const LEAD = {
	before: "Fey joined ",
	linkText: "Wealthsimple",
	href: "https://www.wealthsimple.com/",
	after: ".",
};

const PARAGRAPHS = [
	"Everything we built at Fey—our technology, design philosophy, and relentless focus on clarity—is now helping shape what comes next at Wealthsimple, across investing and banking.",
	"Fey proved that a small, independent team could raise the bar in a category that had settled for less. We built with taste, conviction, and an obsession with making finance feel simpler, smarter, and genuinely better. Now, with Wealthsimple's scale and reach, that ambition goes further.",
	"Sign-ups to Fey are closed. But the work continues…",
];

const LINKS = [
	{
		label: "Announcement",
		href: "https://newsroom.wealthsimple.com/wealthsimple-acquires-investment-research-platform-fey",
	},
	{
		label: "Why we sold Fey",
		href: "https://x.com/tcosta/status/1961445239945560458",
	},
	{ label: "@brotzky", href: "https://x.com/brotzky" },
	{ label: "@tcosta", href: "https://x.com/tcosta" },
	{ label: "@tjruss", href: "https://x.com/tjruss" },
];

// Seconds for the wave to sweep across all the text.
const WAVE_SECONDS = 0.8;

type Run = { text: string; delay: number };

// Splits copy into runs with no internal break opportunity (break after each dash),
// each delayed by its visible-character position so one wave sweeps in reading order.
function splitParagraphs(leadChars: number, paragraphs: string[]) {
	const totalChars =
		leadChars +
		paragraphs.reduce((sum, p) => sum + (p.match(/\S/g) ?? []).length, 0);
	const step = WAVE_SECONDS / Math.max(totalChars, 1);
	let index = leadChars;
	const split = paragraphs.map((paragraph) =>
		paragraph
			.split(/\s+/)
			.filter(Boolean)
			.map((word) => {
				const runs: Run[] = [];
				let buffer = "";
				for (const char of word) {
					buffer += char;
					if (/[—–-]/.test(char)) {
						runs.push({ text: buffer, delay: index * step });
						index += buffer.length;
						buffer = "";
					}
				}
				if (buffer) {
					runs.push({ text: buffer, delay: index * step });
					index += buffer.length;
				}
				return runs;
			}),
	);
	return split;
}

const leadText = `${LEAD.before}${LEAD.linkText}${LEAD.after}`;
const SPLIT = splitParagraphs((leadText.match(/\S/g) ?? []).length, PARAGRAPHS);

function Word({ run }: { run: Run }) {
	return (
		<span
			className="announcement-word"
			style={{ animationDelay: `${run.delay.toFixed(3)}s` }}
		>
			{run.text}
		</span>
	);
}

function renderWords(words: Run[][]): ReactNode {
	return words.map((runs, wordIndex) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: static copy, order never changes
		<Fragment key={wordIndex}>
			{" "}
			{runs.map((run, runIndex) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static copy, order never changes
				<Fragment key={runIndex}>
					{runIndex > 0 ? <wbr /> : null}
					<Word run={run} />
				</Fragment>
			))}
		</Fragment>
	));
}

export function AnnouncementPage() {
	const [first, second, closing] = SPLIT;
	return (
		<div className="announcement">
			<div className="announcement-bg" />
			<div className="announcement-grain" />
			<main className="announcement-main">
				<div className="announcement-paragraph">
					<h1 className="announcement-word announcement-lead">
						{LEAD.before}
						<a href={LEAD.href} target="_blank" rel="noopener noreferrer">
							{LEAD.linkText}
						</a>
						{LEAD.after}
					</h1>
					{renderWords(first ?? [])}
				</div>
				<p>{renderWords(second ?? [])}</p>
				<p>{renderWords(closing ?? [])}</p>
				{/* Placeholder: drop the founders' signature image here (541×129). */}
				<div
					className="announcement-signatures"
					style={{ animationDelay: `${(WAVE_SECONDS + 0.12).toFixed(3)}s` }}
				>
					Signatures placeholder
				</div>
				<nav className="announcement-links" aria-label="Related links">
					{LINKS.map((link, index) => (
						<a
							key={link.href}
							className="announcement-link"
							href={link.href}
							target="_blank"
							rel="noopener noreferrer"
							style={{ animationDelay: `${(0.3 + index * 0.08).toFixed(3)}s` }}
						>
							{link.label}
							<span className="sr-only"> (opens in new tab)</span>
						</a>
					))}
				</nav>
			</main>
		</div>
	);
}
