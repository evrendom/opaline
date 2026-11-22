import type { ReactNode } from "react";
import { Group, Specimen, State } from "./kit";

/*
 * Only the roles and steps the app's reachable code reads (classes in its
 * .tsx, var(--…) in its .css). A role or step no screen uses is not here.
 */

const GROUND = ["canvas", "surface", "inset", "field", "hover", "hover-strong"];
const INK = ["ink", "ink-2", "ink-3", "ink-4", "ink-inverse"];
const LINES = ["line", "line-soft"];
const ACTION = [
	"primary",
	"primary-hover",
	"primary-fg",
	"focus",
	"focus-ring",
	"accent",
	"accent-tint",
	"accent-line",
	"accent-fg",
];
const STATE = [
	"success",
	"success-tint",
	"success-line",
	"warning",
	"warning-tint",
	"warning-line",
	"error",
	"error-tint",
	"error-line",
];

// Full class names, so Tailwind sees each one in the source.
const BODY = [
	["body-xxs", "text-body-xxs", "avatar initials, dense tags"],
	["body-xs", "text-body-xs", "chart ticks, file badges"],
	["body-s", "text-body-s", "meta lines, sidebar group label"],
	["body-m", "text-body-m", "chips, menus, secondary rows"],
	["body-l", "text-body-l", "list rows, card titles"],
	["body-xl", "text-body-xl", "the body: buttons, settings rows"],
	["body-xxl", "text-body-xxl", "the shell header's page title"],
] as const;
const DISPLAY = [
	["display-xxs", "text-display-xxs", "report title, skill mark"],
	["display-xs", "text-display-xs", "settings page title"],
	["display-s", "text-display-s", "404 and invite pages"],
	["display-xxl", "text-display-xxl", "the skill card's big glyph"],
] as const;
const WEIGHTS = [
	["regular", "font-regular", "toolbar pills, meta"],
	["medium", "font-medium", "titles, buttons, labels"],
	["semibold", "font-semibold", "model badge letters"],
	["heavy", "font-heavy", "404 and invite titles"],
] as const;
const TRACKING = [
	["tracking-xs", "tracking-xs"],
	["tracking-s", "tracking-s"],
	["tracking-m", "tracking-m"],
	["tracking-l", "tracking-l"],
	["tracking-xl", "tracking-xl"],
] as const;
const SPACE = ["xxs", "xs", "s", "m", "l", "xl", "xxl"] as const;
const CORNERS = [
	["zero", "corner-zero"],
	["xs", "corner-xs"],
	["s", "corner-s"],
	["m", "corner-m"],
	["l", "corner-l"],
	["xl", "corner-xl"],
	["full", "corner-full"],
] as const;
const SHADOWS = [
	["card", "cards, panels, controls, chips: anything resting on a ground"],
	["raised", "a pressed toolbar pill, a picked row"],
	["inset", "the inner hairline of a well or shelf"],
	["float", "menus' tab bar, sheets, flyouts, scrub labels"],
] as const;
const DURATIONS = [
	["quick 100ms", "--motion-quick-duration", "menu rows, hover tints"],
	["base 150ms", "--motion-duration", "small changes"],
	["medium 200ms", "--motion-medium-duration", "fades, the trace dock"],
	["large 300ms", "--motion-large-duration", "skeletons, rail rows"],
	["slow 650ms", "--motion-slow-duration", "a chart drawing in"],
] as const;
const EASINGS = [
	["ease-base", "--motion-easing", "the default, the turn rail"],
	["ease-large", "--motion-large-easing", "the range slider's thumb"],
	["ease-strong", "--motion-strong-easing", "presses, the welcome steps"],
	["ease-drawer", "--motion-drawer-easing", "the sidebar, compass lanes"],
	["ease-wave", "--motion-wave-easing", "activity strip, chart loading"],
] as const;

function Swatches({ names }: { names: string[] }) {
	return (
		<div className="grid w-full grid-cols-6 gap-m">
			{names.map((name) => (
				<div key={name} className="flex flex-col gap-xs">
					<div
						className="h-8 corner-xs shadow-inset"
						style={{ background: `var(--${name})` }}
					/>
					<span className="text-body-xs text-ink-3">{name}</span>
				</div>
			))}
		</div>
	);
}

function Line({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex w-full flex-wrap items-baseline gap-m">
			<span className="w-28 shrink-0 font-data text-body-s text-ink-3">
				{label}
			</span>
			{children}
		</div>
	);
}

function MotionBar({
	label,
	duration,
	easing,
	use,
}: {
	label: string;
	duration: string;
	easing: string;
	use: string;
}) {
	return (
		<div className="group flex w-full flex-wrap items-center gap-m">
			<span className="w-28 shrink-0 font-data text-body-s text-ink-3">
				{label}
			</span>
			<div className="h-2 w-40 corner-full bg-field">
				<div
					className="h-2 w-4 corner-full bg-ink transition-[width] group-hover:w-40"
					style={{
						transitionDuration: `var(${duration})`,
						transitionTimingFunction: `var(${easing})`,
					}}
				/>
			</div>
			<span className="text-body-m text-ink-3">{use}</span>
		</div>
	);
}

export function FoundationsGroup() {
	return (
		<Group title="Foundations">
			<Specimen
				name="Roles"
				source="app/tokens.css"
				where="Every screen reads these; success-line is defined but unused, so it is not shown."
				className="flex-col gap-l"
			>
				<Line label="ground">
					<Swatches names={GROUND} />
				</Line>
				<Line label="ink">
					<Swatches names={INK} />
				</Line>
				<Line label="lines">
					<Swatches names={LINES} />
				</Line>
				<Line label="action">
					<Swatches names={ACTION} />
				</Line>
				<Line label="state">
					<Swatches names={STATE} />
				</Line>
			</Specimen>

			<Specimen
				name="Type"
				source="app/theme.css"
				where="One typeface, Inter; display steps are larger Inter. Geist Mono (font-data) for figures, ids and code."
				className="flex-col gap-m"
			>
				{BODY.map(([step, style, use]) => (
					<Line key={step} label={step}>
						<span className={`${style} text-ink`}>Sessions this week</span>
						<span className="text-body-s text-ink-3">{use}</span>
					</Line>
				))}
				{DISPLAY.map(([step, style, use]) => (
					<Line key={step} label={step}>
						<span className={`${style} font-medium text-ink`}>Account</span>
						<span className="text-body-s text-ink-3">{use}</span>
					</Line>
				))}
				{WEIGHTS.map(([weight, style, use]) => (
					<Line key={weight} label={weight}>
						<span className={`${style} text-body-xl text-ink`}>
							Opaline Demo
						</span>
						<span className="text-body-s text-ink-3">{use}</span>
					</Line>
				))}
				<Line label="font-data">
					<span className="font-data text-body-xl text-ink tabular-nums">
						01a057ef · $180.06 · 1.3B tok
					</span>
				</Line>
				{TRACKING.map(([label, style]) => (
					<Line key={label} label={label}>
						<span className={`${style} text-body-xl text-ink`}>
							Sessions this week
						</span>
					</Line>
				))}
				<Line label="line-solid">
					<span className="inline-flex h-5 items-center corner-full bg-field px-m text-body-s line-solid text-ink-2">
						set solid in a chip
					</span>
				</Line>
				<Line label="line-tight">
					<span className="text-body-xs line-tight text-ink-2">
						A dense figure row
						<br />
						on two lines
					</span>
				</Line>
			</Specimen>

			<Specimen
				name="Space"
				source="app/tokens.css"
				where="Padding, margins and gaps; zero is the only other step."
			>
				{SPACE.map((step) => (
					<State key={step} label={step} className="items-center">
						<div
							className="h-4 bg-accent"
							style={{ width: `var(--space-${step})` }}
						/>
					</State>
				))}
			</Specimen>

			<Specimen
				name="Corners"
				source="app/tokens.css"
				where="Every box's corners; squircle steps, and nested corners where a box sits inside another."
			>
				{CORNERS.map(([step, corner]) => (
					<State key={step} label={step} className="items-center">
						<div className={`size-10 bg-field shadow-inset ${corner}`} />
					</State>
				))}
				<State label="squircle: card, panel" className="items-center">
					<div className="size-16 bg-surface shadow-card corner-m squircle:corner-xl corner-squircle" />
				</State>
				<State label="xl-inset (1px)" className="items-center">
					<div className="relative size-16 bg-surface shadow-card corner-s squircle:corner-xl corner-squircle">
						<div className="absolute inset-px bg-hover-strong corner-s-inset squircle:corner-xl-inset corner-squircle" />
					</div>
				</State>
				<State label="xl-inner" className="items-center">
					<div className="relative size-16 bg-surface shadow-card corner-m squircle:corner-xl corner-squircle">
						<div className="absolute inset-xs bg-hover-strong corner-s squircle:corner-xl-inner corner-squircle" />
					</div>
				</State>
				<State label="xl-outer" className="items-center">
					<div className="relative p-xs">
						<div className="absolute inset-0 edge-s border-dashed border-accent-line corner-l squircle:corner-xl-outer corner-squircle" />
						<div className="size-14 bg-field corner-m squircle:corner-xl corner-squircle" />
					</div>
				</State>
			</Specimen>

			<Specimen
				name="Elevation"
				source="app/tokens.css"
				where="Each elevation role, with the place the app uses it."
				className="grid w-full grid-cols-4 gap-xl"
			>
				{SHADOWS.map(([name, use]) => (
					<div key={name} className="flex flex-col gap-s">
						<div
							className="h-10 w-full corner-s bg-surface"
							style={{ boxShadow: `var(--shadow-${name})` }}
						/>
						<span className="text-body-s text-ink">{name}</span>
						<span className="text-body-xs text-ink-3">{use}</span>
					</div>
				))}
			</Specimen>

			<Specimen
				name="Motion"
				source="app/tokens.css"
				where="Hover a row to play it."
				className="flex-col gap-m"
			>
				{DURATIONS.map(([label, duration, use]) => (
					<MotionBar
						key={label}
						label={label}
						duration={duration}
						easing="--motion-easing"
						use={use}
					/>
				))}
				{EASINGS.map(([label, easing, use]) => (
					<MotionBar
						key={label}
						label={label}
						duration="--motion-large-duration"
						easing={easing}
						use={use}
					/>
				))}
			</Specimen>
		</Group>
	);
}
