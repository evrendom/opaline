import { AnimatePresence, motion } from "motion/react";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	EFFORT_LABELS,
	REASONING_EFFORTS,
} from "../../trends/trends-benchmarks";
import { formatMonth } from "../../trends/trends-format";
import type {
	TrendsHarness,
	TrendsProvider,
	TrendsReasoningEffort,
} from "../../trends/trends-snapshot";
import {
	bySizeDescending,
	HARNESS_LABELS,
	inkOn,
	PROVIDER_LABELS,
} from "./trends-colors";
import { HarnessMark, ProviderMark } from "./trends-marks";
import { ROW_GLIDE } from "./trends-motion";
import type { InspectedPeriod } from "./trends-plot-charts";
import type { RankRowsGeometry } from "./trends-rank-rows";

/** Which ends of the Pareto frontier a model holds: its smartest point,
 * its cheapest (or fastest) point, both, or neither. */
export interface ParetoEnds {
	readonly smart: boolean;
	readonly cheap: boolean;
}

/**
 * The Pareto tag's icons: a brain for the smart end, a dollar for the cheap
 * end, a clock for the fast end. Shapes from Hugeicons (MIT), the set
 * Opaline's app uses: BrainIcon, Dollar01Icon and Clock01Icon.
 */
function ParetoIcon({ kind }: { readonly kind: "smart" | "cheap" | "fast" }) {
	return (
		<svg
			className="trends-picker-pareto-icon"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			{kind === "smart" ? (
				<>
					<path d="M16.998 7.12652C17.3182 7.04393 17.654 7 18 7C20.2091 7 22 8.79086 22 11C22 13.2091 20.2091 15 18 15C17.6451 15 17.3009 14.9538 16.9733 14.867M16.998 7.12652C16.9993 7.08451 17 7.04233 17 7C17 4.79086 15.2091 3 13 3C11.0824 3 9.47994 4.34939 9.09041 6.15043M16.998 7.12652C16.9769 7.80763 16.7854 8.44584 16.4649 9M16.9733 14.867C16.9909 14.7472 17 14.6247 17 14.5C17 13.2905 16.1411 12.2816 15 12.05M16.9733 14.867C16.7957 16.0737 15.756 17 14.5 17H14C11.7909 17 10 18.7909 10 21M9.09041 6.15043C8.74377 6.05243 8.37801 6 8 6C5.79086 6 4 7.79086 4 10C4 10.3886 4.05542 10.7643 4.15878 11.1195M9.09041 6.15043C10.1015 6.43625 10.9498 7.10965 11.4649 8M4.15878 11.1195C2.9114 11.4832 2 12.6352 2 14C2 15.6569 3.34315 17 5 17C6.30622 17 7.41746 16.1652 7.82929 15M4.15878 11.1195C4.24921 11.4303 4.37632 11.7255 4.53513 12" />
					<path d="M11.8361 11.7435C11.3257 12.2353 10.453 12.3202 9.70713 11.9008C8.9612 11.4814 8.58031 10.6917 8.73535 10" />
				</>
			) : kind === "cheap" ? (
				<>
					<path d="M17.9583 8.38889C17.9583 6.24111 15.2907 4.5 12 4.5C8.7093 4.5 6.04167 6.24111 6.04167 8.38889C6.04167 10.5367 7.66667 11.7222 12 11.7222C16.3333 11.7222 18.5 12.8333 18.5 15.6111C18.5 18.3889 15.5899 19.5 12 19.5C8.41015 19.5 5.5 17.7589 5.5 15.6111" />
					<path d="M12.5 2.5V4.21M12.5 21.5V19.79" />
				</>
			) : (
				<>
					<circle cx="12" cy="12" r="10" />
					<path d="M12 8V12L14 14" />
				</>
			)}
		</svg>
	);
}

/** A quick pick above "All models". */
export interface PickerPreset {
	readonly id: string;
	/** Spoken name, for when the label is logos. */
	readonly name: string;
	readonly label: ReactNode;
	readonly ids: ReadonlySet<string>;
	/** Also draws the Pareto line through its models. */
	readonly frontier?: boolean;
}

export interface PickerModel {
	readonly id: string;
	readonly name: string;
	readonly provider: TrendsProvider;
	/** Opaline recommends it: listed on top whether shown or not. */
	readonly recommended: boolean;
	/** Series color; the picker doubles as the chart legend. */
	readonly color?: string;
	/** Size proxy (output list price); rows list biggest first. */
	readonly size?: number | null;
	readonly releasedAt?: string | null;
}

interface PickerProps {
	readonly models: readonly PickerModel[];
	readonly selected: ReadonlySet<string>;
	readonly onSelection: (ids: Set<string>) => void;
	readonly onReset: () => void;
	readonly efforts?: ReadonlySet<TrendsReasoningEffort>;
	readonly onEfforts?: (efforts: Set<TrendsReasoningEffort>) => void;
	readonly focusIds: ReadonlySet<string>;
	/** A shown model's row under the pointer (or its dot under keyboard
	 * focus) focuses it on the chart; undefined when it leaves. */
	readonly onHoverModel: (id: string | undefined) => void;
	/** With the Pareto frontier on: its models lead, the rest step back. */
	readonly frontierIds?: ReadonlySet<string>;
	/** "Hide non-Pareto models": leave the models off the frontier out of the list. */
	readonly hideOffFrontier?: boolean;
	/** Models kept in the list beside the chart, shown on it or not. */
	readonly listedIds?: ReadonlySet<string>;
	/** The models the chart can draw, when not every one: the list beside
	 * it keeps to them, whatever else is listed or selected. */
	readonly drawableIds?: ReadonlySet<string>;
	/** Takes a model out of the list, back to "Other models". */
	readonly onRemove?: (id: string) => void;
	/** Models on the Pareto frontier of every model available, tagged in
	 * "All models" by the chart quadrant they sit in: a brain in the smarter
	 * half, a dollar (or clock) in the cheaper (or faster) half. */
	readonly paretoEnds?: ReadonlyMap<string, ParetoEnds>;
	/** What the cheap end means on this chart. */
	readonly paretoCheap?: "cheap" | "fast";
	/** The newest models of the frontier labs, first in "All models". */
	readonly featuredIds?: ReadonlySet<string>;
	/** While points are compared, their models; the list fades the rest. */
	readonly comparingIds?: ReadonlySet<string>;
	/** One-click sets above "All models": each puts exactly its models on
	 * the chart and in the list. */
	readonly presets?: readonly PickerPreset[];
	readonly onPreset?: (preset: PickerPreset) => void;
	/** Settings at the top of the legend, under the "All models" bar. */
	readonly listControls?: ReactNode;
	/** The "All models" menu opened or shut: the user is picking models. */
	readonly onPickingChange?: (picking: boolean) => void;
	/** The chart compares harnesses, not models: the list groups its models
	 * under the harness that runs them, and the controls for picking models
	 * fade out. */
	readonly byHarness?: boolean;
	/** The chart reads its own models (Agent runs, every model together):
	 * the list shows them, ticked and locked, without the menu to pick
	 * others, the × or the hover focus. */
	readonly fixed?: boolean;
	/** The hovered period's figure per model on the share and volume
	 * charts, shown beside each row instead of a card over the chart. */
	readonly inspected?: InspectedPeriod;
	/** A ranking on its side beside the list: each listed row stands at its
	 * bar's height, in its order (the rest below), and glides with it. */
	readonly alignTo?: RankRowsGeometry;
}

// The lab icon already says Anthropic or OpenAI, so rows drop "Claude" and
// "GPT-"; the accessible names and search keep the full model name.

/** Most models the chart shows at once. */
export const MAX_SHOWN = 15;

// Companies people code with lead; the rest follow the label order.
const COMPANY_ORDER = Object.keys(PROVIDER_LABELS) as TrendsProvider[];

/** A model's line within its company: "Opus" for Claude Opus 4.8, "Sol"
 * for GPT-5.6 Sol; empty for a bare number (GPT-5.5). */
function modelLine(model: PickerModel) {
	return model.name
		.replace(/^(Claude |GPT-)/, "")
		.replace(/\d+(\.\d+)*/g, "")
		.trim();
}

/** Agent runs' order: company, then line by name (bare numbers last),
 * then the newest release first. */
function byLineNewest(models: readonly PickerModel[]) {
	return [...models].sort((first, second) => {
		const company =
			COMPANY_ORDER.indexOf(first.provider) -
			COMPANY_ORDER.indexOf(second.provider);
		if (company !== 0) return company;
		const firstLine = modelLine(first);
		const secondLine = modelLine(second);
		if (firstLine !== secondLine)
			return !firstLine
				? 1
				: !secondLine
					? -1
					: firstLine.localeCompare(secondLine);
		return (second.releasedAt ?? "").localeCompare(first.releasedAt ?? "");
	});
}

function byCompany(models: readonly PickerModel[]) {
	const companies = new Map<TrendsProvider, PickerModel[]>();
	for (const model of models)
		companies.set(model.provider, [
			...(companies.get(model.provider) ?? []),
			model,
		]);
	return [...companies]
		.sort(
			([first], [second]) =>
				COMPANY_ORDER.indexOf(first) - COMPANY_ORDER.indexOf(second),
		)
		.map(
			([provider, companyModels]) =>
				[
					provider,
					[...companyModels].sort((first, second) =>
						bySizeDescending(
							{ ...first, releasedAt: first.releasedAt ?? null },
							{ ...second, releasedAt: second.releasedAt ?? null },
						),
					),
				] as const,
		);
}

/** The model ids in the list's order: companies first to last, each one's
 * models biggest first. */
export function legendOrder(models: readonly PickerModel[]) {
	return byCompany(models).flatMap(([, companyModels]) =>
		companyModels.map((model) => model.id),
	);
}

// Which harness runs a lab's models; the rest have none on the chart.
const HARNESS_OF: Partial<Record<TrendsProvider, TrendsHarness>> = {
	anthropic: "claude-code",
	openai: "codex",
};

export function TrendsModelPicker({
	models,
	selected,
	onSelection,
	onReset,
	efforts,
	onEfforts,
	focusIds,
	onHoverModel,
	frontierIds,
	hideOffFrontier = false,
	listedIds,
	drawableIds,
	onRemove,
	paretoEnds,
	paretoCheap = "cheap",
	featuredIds,
	comparingIds,
	presets = [],
	onPreset,
	onPickingChange,
	listControls,
	byHarness = false,
	fixed = false,
	inspected,
	alignTo,
}: PickerProps) {
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const id = useId();
	const search = query.trim().toLowerCase();
	const matches = (model: PickerModel) =>
		`${model.name} ${model.provider}`.toLowerCase().includes(search);
	// One rule: the list beside the chart holds the listed models (the
	// recommended ones to start with, plus any added from "Other models") and
	// anything on the chart. Its dot shows or hides a model on the chart and
	// keeps it listed; only its × sends it back to "Other models".
	const isActive = (model: PickerModel) =>
		(drawableIds?.has(model.id) ?? true) &&
		(listedIds?.has(model.id) || selected.has(model.id));
	const active = models.filter(isActive);
	// "All models" lists every model, on the chart or not, so its dots show
	// what is selected; a search narrows it.
	const allModels = search ? models.filter(matches) : models;
	// The chart shows at most MAX_SHOWN models; once full, a model waits to
	// be shown until another is hidden.
	const full = selected.size >= MAX_SHOWN;
	// The other models float over the list's foot, collapsed until opened.
	const [othersOpen, setOthersOpen] = useState(false);
	useEffect(() => {
		onPickingChange?.(othersOpen);
	}, [othersOpen, onPickingChange]);
	// Picking models has no say over the harness chart: the menu shuts.
	useEffect(() => {
		if (byHarness || fixed) setOthersOpen(false);
	}, [byHarness, fixed]);
	// One fixed order, companies biggest first, whatever chart is shown: the
	// charts' leaders run into the rows, the rows never move to meet them.
	// Agent runs, a key with no leaders, lists each line newest first.
	const ordered = (list: readonly PickerModel[]) =>
		fixed
			? byLineNewest(list)
			: byCompany(list).flatMap(([, companyModels]) => companyModels);
	// Where the list stands, and one row's height, to line its rows up with
	// a ranking beside it.
	const listRef = useRef<HTMLUListElement>(null);
	const [listBox, setListBox] = useState<{
		readonly top: number;
		readonly left: number;
		readonly row: number;
	}>();
	useLayoutEffect(() => {
		const list = listRef.current;
		if (!alignTo || !list) return;
		const measure = () => {
			const rect = list.getBoundingClientRect();
			const row =
				list.querySelector("li")?.getBoundingClientRect().height ?? 32;
			setListBox((current) =>
				current &&
				current.top === rect.top &&
				current.left === rect.left &&
				current.row === row
					? current
					: { top: rect.top, left: rect.left, row },
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(list);
		return () => observer.disconnect();
	}, [alignTo]);
	// One list, so rows glide rather than jump between lists. On the harness
	// chart each harness's heading stands over the models it runs (the
	// labs list in that order already); headings fade in once the rows have
	// made room, and fade out of the way as the rows close up.
	const legendList = (list: readonly PickerModel[]) => {
		const items: ReactNode[] = [];
		let group: TrendsHarness | "other" | undefined;
		// Lined up with a ranking beside it: its order, each row at its bar.
		const aligned =
			alignTo && listBox && listBox.left >= alignTo.right - 1
				? alignTo
				: undefined;
		const rank = (model: PickerModel) => {
			const index = aligned?.order.indexOf(model.id) ?? -1;
			return index === -1 ? Number.MAX_SAFE_INTEGER : index;
		};
		const rows = aligned
			? [...ordered(list)].sort((first, second) => rank(first) - rank(second))
			: ordered(list);
		let below = 0;
		const topOf = (model: PickerModel) => {
			if (!aligned || !listBox) return undefined;
			const index = aligned.order.indexOf(model.id);
			const barsTop = aligned.top - listBox.top;
			if (index !== -1)
				return barsTop + (index + 0.5) * aligned.pitch - listBox.row / 2;
			below += 1;
			return (
				barsTop +
				aligned.order.length * aligned.pitch +
				(below - 1) * listBox.row
			);
		};
		let bottom = 0;
		for (const model of rows) {
			const harness = byHarness
				? (HARNESS_OF[model.provider] ?? "other")
				: undefined;
			if (harness && harness !== group)
				items.push(
					<motion.li
						key={`harness-${harness}`}
						className="trends-picker-company-name trends-picker-harness-head"
						layout="position"
						transition={ROW_GLIDE}
						initial={{ opacity: 0 }}
						animate={{
							opacity: 1,
							transition: { duration: 0.3, delay: 0.18 },
						}}
						exit={{ opacity: 0, transition: { duration: 0.15 } }}
					>
						{harness === "other" ? (
							"Other models"
						) : (
							<>
								<HarnessMark harness={harness} />
								{HARNESS_LABELS[harness]}
							</>
						)}
					</motion.li>,
				);
			group = harness;
			const top = topOf(model);
			if (top !== undefined)
				bottom = Math.max(bottom, top + (listBox?.row ?? 0));
			items.push(row(model, true, top));
		}
		return (
			<ul
				ref={listRef}
				data-aligned={aligned ? true : undefined}
				style={aligned ? { minHeight: bottom } : undefined}
			>
				<AnimatePresence mode="popLayout" initial={false}>
					{items}
				</AnimatePresence>
			</ul>
		);
	};
	// Every model to pick from: the frontier labs' newest first, then all
	// the rest (their older models included) under their company's name.
	const featured = (model: PickerModel) => featuredIds?.has(model.id) ?? false;
	const companyList = (list: readonly PickerModel[]) => (
		<ul className="trends-picker-companies">
			{list.some(featured) ? (
				<li key="frontier-labs" className="trends-picker-company">
					<p className="trends-picker-company-name">Frontier</p>
					<ul>
						{byCompany(list.filter(featured)).flatMap(([, companyModels]) =>
							companyModels.map(allRow),
						)}
					</ul>
				</li>
			) : null}
			{byCompany(list.filter((model) => !featured(model))).map(
				([provider, companyModels]) => (
					<li key={provider} className="trends-picker-company">
						<p className="trends-picker-company-name">
							<ProviderMark provider={provider} />
							{PROVIDER_LABELS[provider]}
						</p>
						<ul>{companyModels.map(allRow)}</ul>
					</li>
				),
			)}
		</ul>
	);
	// A row in "All models": its dot (and name) show or hide the model on the
	// chart, and showing it adds it to the list above.
	function allRow(model: PickerModel) {
		const shown = selected.has(model.id);
		const paretoEnd = paretoEnds?.get(model.id);
		const blocked = full && !shown;
		return (
			<li key={model.id} className="trends-picker-model" data-selected={shown}>
				<input
					type="checkbox"
					className="trends-picker-dot"
					style={
						model.color
							? ({ "--key-color": model.color } as CSSProperties)
							: undefined
					}
					checked={shown}
					disabled={blocked}
					onChange={() => toggle([model.id])}
					aria-label={`Show ${model.name}`}
				/>
				<ProviderMark provider={model.provider} />
				<button
					type="button"
					className="trends-picker-name"
					aria-pressed={shown}
					disabled={blocked}
					onClick={() => toggle([model.id])}
				>
					{model.name.replace(/^(Claude |GPT-)/, "")}
				</button>
				{paretoEnd ? (
					<span
						className="trends-picker-pareto"
						title={`On the Pareto frontier of all models${
							paretoEnd.smart && paretoEnd.cheap
								? ", at both its ends"
								: paretoEnd.smart
									? ", its smartest end"
									: paretoEnd.cheap
										? `, its ${paretoCheap === "fast" ? "fastest" : "cheapest"} end`
										: ""
						}`}
					>
						{paretoEnd.smart ? <ParetoIcon kind="smart" /> : null}
						{paretoEnd.cheap ? <ParetoIcon kind={paretoCheap} /> : null}
						Pareto
					</span>
				) : null}
			</li>
		);
	}
	function row(model: PickerModel, legend: boolean, top?: number) {
		const inputId = `${id}-${model.id}`;
		return (
			// Rows glide to a new place when the list changes (as when a
			// model is added from the other models, or a tab lists others);
			// a row leaving fades out first, one joining fades in once the
			// rows have made room, as the harness headings do.
			<motion.li
				key={model.id}
				layoutId={`${id}-row-${model.id}`}
				layout="position"
				transition={ROW_GLIDE}
				initial={{ opacity: 0 }}
				animate={{
					opacity: 1,
					transition: { duration: 0.3, delay: 0.18 },
				}}
				exit={{ opacity: 0, transition: { duration: 0.15 } }}
				className="trends-picker-model"
				// At its bar's height when lined up with a ranking.
				style={top === undefined ? undefined : { top }}
				data-focused={focusIds.has(model.id)}
				data-selected={selected.has(model.id)}
				onPointerEnter={() => hover(model.id)}
				onPointerLeave={() => onHoverModel(undefined)}
				data-off-frontier={
					frontierIds && legend ? !frontierIds.has(model.id) : undefined
				}
				data-compared={
					comparingIds && legend ? comparingIds.has(model.id) : undefined
				}
				// "Hide non-Pareto models" fades the models on the chart but off the
				// frontier out where they stand, so the rows around them never
				// move. Models unticked by hand stay, faded, to be ticked back.
				data-hidden={
					legend && hideOffFrontier && frontierIds
						? selected.has(model.id) && !frontierIds.has(model.id)
						: undefined
				}
				inert={
					legend && hideOffFrontier && frontierIds
						? selected.has(model.id) && !frontierIds.has(model.id)
						: undefined
				}
			>
				<input
					id={inputId}
					type="checkbox"
					className="trends-picker-dot"
					data-legend-id={model.id}
					style={
						model.color
							? ({
									"--key-color": model.color,
								} as CSSProperties)
							: undefined
					}
					checked={selected.has(model.id)}
					disabled={fixed || (full && !selected.has(model.id))}
					onChange={() => toggle([model.id])}
					onFocus={(event) => {
						if (event.currentTarget.matches(":focus-visible")) hover(model.id);
					}}
					onBlur={() => onHoverModel(undefined)}
					aria-label={`Show ${model.name}`}
				/>
				<ProviderMark provider={model.provider} />
				<span className="trends-picker-name">
					{model.name.replace(/^(Claude |GPT-)/, "")}
					{/* On the columns, the hovered or pinned column's reasoning
					    effort, after the name. */}
					{inspected?.notes?.has(model.id) ? (
						<span className="trends-picker-name-note">
							{inspected.notes.get(model.id)}
						</span>
					) : null}
				</span>
				{/* Agent runs' list dates each model's release instead; it
				    fades in and out with the tab. On the share and volume
				    charts, the hovered period's figure stands there; on the
				    columns, the hovered or pinned column's. */}
				<AnimatePresence initial={false}>
					{fixed && model.releasedAt && !inspected?.values.has(model.id) ? (
						<motion.span
							key="released"
							className="trends-picker-released"
							initial={{ opacity: 0 }}
							animate={{
								opacity: 1,
								transition: { duration: 0.3, delay: 0.18 },
							}}
							exit={{ opacity: 0, transition: { duration: 0.15 } }}
						>
							{formatMonth(model.releasedAt)}
						</motion.span>
					) : null}
					{inspected?.values.has(model.id) ? (
						<motion.span
							key="inspected"
							className="trends-picker-released trends-picker-inspected"
							style={
								model.color
									? ({
											"--key-color": model.color,
											"--key-ink": inkOn(model.color),
										} as CSSProperties)
									: undefined
							}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1, transition: { duration: 0.12 } }}
							exit={{ opacity: 0, transition: { duration: 0.12 } }}
						>
							<span
								className="trends-picker-inspected-figure"
								data-leader={inspected.leaderId === model.id}
							>
								{inspected.values.get(model.id)}
							</span>
						</motion.span>
					) : null}
				</AnimatePresence>
				{legend && onRemove && !fixed ? (
					<button
						type="button"
						className="trends-picker-remove"
						aria-label={`Remove ${model.name} from the list`}
						title="Remove from the list"
						onClick={() => onRemove(model.id)}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
						</svg>
					</button>
				) : null}
			</motion.li>
		);
	}
	useEffect(() => {
		let frame = 0;
		const shortcut = (event: globalThis.KeyboardEvent) => {
			if (
				event.key !== "/" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				event.repeat ||
				document.querySelector("dialog[open]") ||
				(event.target instanceof HTMLElement &&
					event.target.closest("input, textarea, select, [contenteditable]"))
			)
				return;
			event.preventDefault();
			setOthersOpen(true);
			frame = requestAnimationFrame(() => searchRef.current?.focus());
		};
		window.addEventListener("keydown", shortcut);
		return () => {
			window.removeEventListener("keydown", shortcut);
			cancelAnimationFrame(frame);
		};
	}, []);
	// Only a model on the chart can take the focus.
	const hover = (modelId: string) =>
		onHoverModel(selected.has(modelId) && !fixed ? modelId : undefined);
	const toggle = (ids: readonly string[]) => {
		const next = new Set(selected);
		const remove = ids.every((modelId) => next.has(modelId));
		for (const modelId of ids) {
			if (remove) next.delete(modelId);
			else next.add(modelId);
		}
		onSelection(next);
	};
	return (
		<>
			{/* The model list stands on the dashboard's right. */}
			<aside
				className="trends-models trends-models-legend"
				aria-label="Models"
				data-by-harness={byHarness}
				data-fixed={fixed}
			>
				<div className="trends-models-list">
					{listControls ? (
						<div className="trends-legend-controls">{listControls}</div>
					) : null}
					{/* One list: with the frontier on, the models off it fade (or,
					    hidden, fade out) where they stand. */}
					<div
						className="trends-picker-group"
						data-group="active"
						inert={byHarness}
					>
						{legendList(active)}
					</div>
					{models.length === 0 ? (
						<output className="trends-picker-empty">
							No published models.
						</output>
					) : null}
					{/* Hidden for now: Clear.
				<div className="trends-picker-actions">
					<button type="button" onClick={() => onSelection(new Set())}>
						Clear
					</button>
				</div>
				*/}
				</div>
				{models.length > 0 ? (
					<div
						className="trends-picker-others"
						data-open={othersOpen}
						inert={byHarness || fixed}
					>
						{/* The whole header opens and shuts the card (the toggle's
						    click area stretches over it); Reset sits on top. */}
						<div className="trends-picker-others-head">
							<button
								type="button"
								className="trends-picker-others-toggle"
								aria-expanded={othersOpen}
								aria-controls={`${id}-others`}
								onClick={() => setOthersOpen(!othersOpen)}
							>
								All models
								<span className="trends-group-count">
									<span aria-hidden="true">
										{selected.size}/{MAX_SHOWN}
									</span>
									<span className="visually-hidden">
										{selected.size} of at most {MAX_SHOWN} shown
									</span>
								</span>
							</button>
							<button
								type="button"
								className="trends-picker-others-reset"
								onClick={() => {
									setQuery("");
									onReset();
								}}
							>
								Reset
							</button>
							{/* Expand while shut, collapse while open; they cross-fade. */}
							<span className="trends-picker-others-icon" aria-hidden="true">
								<svg viewBox="0 0 16 16" data-icon="expand" aria-hidden="true">
									<path d="M10 2.75h3.25V6M6 13.25H2.75V10M13.25 2.75 9.25 6.75M2.75 13.25l4-4" />
								</svg>
								<svg
									viewBox="0 0 16 16"
									data-icon="collapse"
									aria-hidden="true"
								>
									<path d="M2.75 9.25H6.75v4M13.25 6.75H9.25v-4M9.25 6.75l4-4M6.75 9.25l-4 4" />
								</svg>
							</span>
						</div>
						{/* Height animates open and shut; the list scrolls on its own,
						    so the legend and its leaders stay put. */}
						<div className="trends-picker-others-body">
							<div
								id={`${id}-others`}
								className="trends-picker-all"
								inert={!othersOpen}
							>
								{efforts && onEfforts ? (
									<div className="trends-menu-settings">
										<fieldset className="trends-efforts">
											<legend>Reasoning</legend>
											<div className="trends-efforts-track">
												{REASONING_EFFORTS.map((effort) => (
													<label
														key={effort}
														data-on={efforts.has(effort)}
														title={effort}
													>
														<input
															type="checkbox"
															checked={efforts.has(effort)}
															aria-label={`${effort} reasoning`}
															onChange={() => {
																const next = new Set(efforts);
																if (next.has(effort)) next.delete(effort);
																else next.add(effort);
																onEfforts(next);
															}}
														/>
														<span aria-hidden="true">
															{EFFORT_LABELS[effort]}
														</span>
													</label>
												))}
											</div>
										</fieldset>
									</div>
								) : null}
								<label className="trends-model-search">
									<input
										ref={searchRef}
										type="search"
										value={query}
										placeholder="Find models"
										aria-label="Find models"
										onChange={(event) => setQuery(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Escape") {
												setQuery("");
												event.currentTarget.blur();
											}
										}}
									/>
									<kbd>/</kbd>
								</label>
								{presets.length > 0 && onPreset ? (
									<fieldset className="trends-picker-presets">
										<legend className="visually-hidden">Quick picks</legend>
										{presets.map((preset) => {
											const active =
												preset.ids.size === selected.size &&
												[...preset.ids].every((modelId) =>
													selected.has(modelId),
												);
											return (
												<button
													key={preset.id}
													type="button"
													className="trends-picker-preset"
													aria-pressed={active}
													aria-label={preset.name}
													disabled={preset.ids.size === 0}
													// Clicked again, the pick lets go: back to the
													// default models.
													onClick={() =>
														active ? onReset() : onPreset(preset)
													}
												>
													{preset.label}
												</button>
											);
										})}
									</fieldset>
								) : null}
								<div className="trends-picker-scroll">
									{full ? (
										<p className="trends-picker-full">
											The chart shows {MAX_SHOWN} models at most. Hide one to
											show another.
										</p>
									) : null}
									{allModels.length > 0 ? (
										companyList(allModels)
									) : (
										<output className="trends-picker-empty">
											No matching models.
										</output>
									)}
								</div>
							</div>
						</div>
					</div>
				) : null}
			</aside>
		</>
	);
}
