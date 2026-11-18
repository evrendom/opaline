import { useCallback, useEffect, useRef, useState } from "react";
import { TrendsExplorer } from "../components/trends/TrendsExplorer";
import {
	buildChartCard,
	type ChartCard,
	type ChartExport,
	chartCardPng,
} from "../components/trends/trends-export";
import type { TrendsLiveSources } from "../trends/assemble-trends-snapshot";
import type { TrendsSnapshot } from "../trends/trends-snapshot";
import "./trends-card-playground.css";

/*
 * A dev-only playground for the PNG cards Trends exports: the camera button
 * on any chart drops its card here instead of downloading it. Cards are
 * drawn as live SVG, so Agentation can point at their parts; the PNG view
 * shows the pixels the download would hold. Each card remembers the chart's
 * link (the explorer's hash), so "Recapture all" rebuilds every card with
 * the current export code after an edit.
 */

interface Capture {
	readonly id: string;
	readonly hash: string;
	readonly title: string;
	readonly fileName: string;
	readonly scheme: "light" | "dark";
	readonly markup: string;
	readonly width: number;
	readonly height: number;
}

type Backdrop = "checker" | "light" | "dark";
type View = "svg" | "png";
type Zoom = "fit" | "actual";

const STORAGE_KEY = "opaline-trends-card-playground";

export function TrendsCardPlayground({
	snapshot,
	live,
}: {
	snapshot: TrendsSnapshot;
	live: TrendsLiveSources;
}) {
	const [captures, setCaptures] = useState<readonly Capture[]>([]);
	const [hashes, setHashes] = useState<readonly string[]>([]);
	const [openId, setOpenId] = useState<string | null>(null);
	const [backdrop, setBackdrop] = useState<Backdrop>("checker");
	const [view, setView] = useState<View>("svg");
	const [zoom, setZoom] = useState<Zoom>("fit");
	// The stage's room for the card, for fitting it.
	const [room, setRoom] = useState<{ width: number; height: number } | null>(
		null,
	);
	const observer = useRef<ResizeObserver | null>(null);
	const stageScroll = useCallback((node: HTMLDivElement | null) => {
		observer.current?.disconnect();
		if (!node) return;
		observer.current = new ResizeObserver(([entry]) => {
			if (entry)
				setRoom({
					width: entry.contentRect.width,
					height: entry.contentRect.height,
				});
		});
		observer.current.observe(node);
	}, []);
	const [busy, setBusy] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	// The capture a recapture replaces, set while it drives the explorer.
	const replacing = useRef<string | null>(null);
	const pending = useRef<(() => void) | null>(null);
	const exported = useRef(false);

	// The charts captured last time, to recapture after a reload.
	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) setHashes(JSON.parse(stored) as string[]);
	}, []);
	useEffect(() => {
		if (captures.length === 0) return;
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify(captures.map((capture) => capture.hash)),
		);
	}, [captures]);

	const onExport = useCallback(async (chart: ChartExport) => {
		exported.current = true;
		const card = await buildChartCard(chart);
		const id = replacing.current ?? crypto.randomUUID();
		const capture: Capture = {
			id,
			hash: window.location.hash,
			title: chart.title,
			fileName: chart.fileName,
			scheme: matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light",
			markup: scopedMarkup(card, id),
			width: card.width,
			height: card.height,
		};
		setCaptures((current) =>
			current.some((existing) => existing.id === id)
				? current.map((existing) => (existing.id === id ? capture : existing))
				: [...current, capture],
		);
		if (!replacing.current) setOpenId(id);
		pending.current?.();
		pending.current = null;
	}, []);

	const notice = (message: string) => {
		setBusy(message);
		setTimeout(() => setBusy(null), 4000);
	};

	const captureShown = () => {
		const button = shownExportButton();
		if (!button) {
			notice("No chart with a PNG button is shown.");
			return;
		}
		exported.current = false;
		button.click();
		// The explorer's button does nothing for charts it can't export
		// (Friction is a table).
		setTimeout(() => {
			if (!exported.current)
				notice("This chart's PNG button did nothing: it has no export.");
		}, 1500);
	};

	// Opens each chart's link in turn and presses its PNG button.
	const recapture = async (
		targets: readonly { id?: string; hash: string }[],
	) => {
		setOpenId(null);
		for (const [index, target] of targets.entries()) {
			setBusy(`Recapturing ${index + 1} of ${targets.length}…`);
			replacing.current = target.id ?? crypto.randomUUID();
			window.location.hash = target.hash;
			await new Promise((resolve) => setTimeout(resolve, 600));
			const done = new Promise<void>((resolve) => {
				pending.current = resolve;
			});
			const button = shownExportButton();
			if (button) {
				button.click();
				await Promise.race([
					done,
					new Promise((resolve) => setTimeout(resolve, 10000)),
				]);
			}
			replacing.current = null;
			pending.current = null;
		}
		setBusy(null);
	};

	const open = captures.find((capture) => capture.id === openId) ?? null;
	const openIndex = open ? captures.indexOf(open) : -1;
	const scale =
		open && room && zoom === "fit"
			? Math.min(1, room.width / open.width, room.height / open.height)
			: 1;

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpenId(null);
			if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
				const step = event.key === "ArrowRight" ? 1 : -1;
				const next =
					captures[(openIndex + step + captures.length) % captures.length];
				if (next) setOpenId(next.id);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, openIndex, captures]);

	return (
		<>
			<TrendsExplorer snapshot={snapshot} live={live} onExport={onExport} />

			<aside className="card-pg-panel" data-collapsed={collapsed}>
				<header className="card-pg-panel-head">
					<button
						type="button"
						className="card-pg-title"
						onClick={() => setCollapsed((value) => !value)}
					>
						Card playground
						<span className="card-pg-count">{captures.length}</span>
					</button>
				</header>
				{collapsed ? null : (
					<>
						<p className="card-pg-hint">
							Press a chart's camera button, or capture the chart on screen.
							Open a card and annotate it with Agentation.
						</p>
						<div className="card-pg-actions">
							<button type="button" onClick={captureShown}>
								Capture shown chart
							</button>
							<button
								type="button"
								disabled={captures.length === 0 && hashes.length === 0}
								onClick={() =>
									recapture(
										captures.length > 0
											? captures
											: hashes.map((hash) => ({ hash })),
									)
								}
							>
								{captures.length > 0
									? "Recapture all"
									: `Restore ${hashes.length} from last time`}
							</button>
							<button
								type="button"
								disabled={captures.length === 0}
								onClick={() => {
									setCaptures([]);
									localStorage.removeItem(STORAGE_KEY);
									setHashes([]);
								}}
							>
								Clear
							</button>
						</div>
						{busy ? <p className="card-pg-busy">{busy}</p> : null}
						<ol className="card-pg-list">
							{captures.map((capture) => (
								<li key={capture.id}>
									<button
										type="button"
										className="card-pg-thumb"
										data-open={capture.id === openId}
										onClick={() => setOpenId(capture.id)}
									>
										<img
											src={svgDataUrl(capture.markup)}
											alt=""
											width={capture.width}
											height={capture.height}
										/>
										<span className="card-pg-thumb-title">{capture.title}</span>
										<span className="card-pg-thumb-meta">
											{capture.width}×{capture.height} · {capture.scheme}
										</span>
									</button>
								</li>
							))}
						</ol>
					</>
				)}
			</aside>

			{open ? (
				<div className="card-pg-stage" data-backdrop={backdrop}>
					<div className="card-pg-stage-bar">
						<div className="card-pg-stage-name">
							<strong>{open.title}</strong>
							<span>
								{open.width}×{open.height} pt · PNG {open.width * 2}×
								{open.height * 2} · {open.scheme}
								{scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ""}
							</span>
						</div>
						<Segmented
							value={view}
							options={[
								["svg", "Live SVG"],
								["png", "PNG"],
							]}
							onChange={setView}
						/>
						<Segmented
							value={zoom}
							options={[
								["fit", "Fit"],
								["actual", "1:1"],
							]}
							onChange={setZoom}
						/>
						<Segmented
							value={backdrop}
							options={[
								["checker", "Checker"],
								["light", "Light"],
								["dark", "Dark"],
							]}
							onChange={setBackdrop}
						/>
						<button
							type="button"
							onClick={() => recapture([{ id: open.id, hash: open.hash }])}
						>
							Recapture
						</button>
						<button type="button" onClick={() => download(open)}>
							Download PNG
						</button>
						<button
							type="button"
							onClick={() =>
								setCaptures((current) =>
									current.filter((capture) => capture.id !== open.id),
								)
							}
						>
							Remove
						</button>
						<button type="button" onClick={() => setOpenId(null)}>
							Close
						</button>
					</div>
					<div className="card-pg-stage-scroll" ref={stageScroll}>
						{view === "svg" ? (
							<div
								className="card-pg-card"
								data-trends-card={open.id}
								style={{ width: open.width, height: open.height, zoom: scale }}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: dev playground rendering its own SVG
								dangerouslySetInnerHTML={{ __html: open.markup }}
							/>
						) : (
							<PngPreview capture={open} scale={scale} />
						)}
					</div>
				</div>
			) : null}
		</>
	);
}

function Segmented<T extends string>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: readonly (readonly [T, string])[];
	onChange: (value: T) => void;
}) {
	return (
		<div className="card-pg-segmented">
			{options.map(([option, label]) => (
				<button
					key={option}
					type="button"
					data-selected={option === value}
					onClick={() => onChange(option)}
				>
					{label}
				</button>
			))}
		</div>
	);
}

function PngPreview({ capture, scale }: { capture: Capture; scale: number }) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		let revoked = false;
		let objectUrl: string | null = null;
		pngOf(capture).then((blob) => {
			if (revoked) return;
			objectUrl = URL.createObjectURL(blob);
			setUrl(objectUrl);
		});
		return () => {
			revoked = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [capture]);
	return url ? (
		<img
			className="card-pg-card"
			style={{ zoom: scale }}
			src={url}
			alt={capture.title}
			width={capture.width}
			height={capture.height}
		/>
	) : (
		<p className="card-pg-busy">Drawing PNG…</p>
	);
}

function shownExportButton() {
	return [
		...document.querySelectorAll<HTMLButtonElement>(
			'.trends-app [data-export="png"]',
		),
	].find((button) => button.offsetParent !== null && !button.disabled);
}

/**
 * The card's markup for inlining in this page: its ids prefixed, so its
 * clip paths and gradients can't resolve to the live chart's, and its
 * stylesheet scoped to the card.
 */
function scopedMarkup(card: ChartCard, id: string) {
	const prefix = `card-${id.slice(0, 8)}-`;
	let markup = new XMLSerializer().serializeToString(card.svg);
	const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
	for (const original of new Set(ids)) {
		if (!original) continue;
		const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		markup = markup
			.replace(
				new RegExp(`(\\sid=")${escaped}"`, "g"),
				`$1${prefix}${original}"`,
			)
			// Quoted references are serialized as &quot; inside style
			// attributes.
			.replace(
				new RegExp(`url\\((&quot;|["'])?#${escaped}(&quot;|["'])?\\)`, "g"),
				`url($1#${prefix}${original}$2)`,
			)
			.replace(
				new RegExp(`(href=")#${escaped}"`, "g"),
				`$1#${prefix}${original}"`,
			);
	}
	return markup.replace(/(^|})text\{/g, `$1[data-trends-card="${id}"] text{`);
}

function svgDataUrl(markup: string) {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function pngOf(capture: Capture) {
	const svg = new DOMParser().parseFromString(capture.markup, "image/svg+xml")
		.documentElement as unknown as SVGSVGElement;
	return chartCardPng({ svg, width: capture.width, height: capture.height });
}

async function download(capture: Capture) {
	const blob = await pngOf(capture);
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = capture.fileName;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
