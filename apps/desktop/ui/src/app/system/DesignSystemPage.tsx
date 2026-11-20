import {
	IconAdjustmentsHorizontal,
	IconCheck,
	IconChevronDown,
	IconFolder,
	IconPlus,
	IconSearch,
	IconTrash,
} from "@tabler/icons-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Avatar, AvatarFallback } from "@/app/ui/avatar";
import { Badge } from "@/app/ui/badge";
import { Button } from "@/app/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/ui/card";
import { Checkbox } from "@/app/ui/checkbox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/app/ui/empty";
import { Input } from "@/app/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/app/ui/input-group";
import { Label } from "@/app/ui/label";
import { Separator } from "@/app/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/app/ui/table";

/**
 * The system page (dev only, /dev/design-system): every role, scale step,
 * primitive and pattern in each state at rest, light beside dark. The page is
 * the spec: a new primitive variant or pattern state gets a specimen here.
 * States are attributes (aria-pressed, data-active, aria-invalid, disabled …)
 * so hover-only looks are the only ones not shown.
 */

const GROUND = [
	"canvas",
	"surface",
	"card",
	"card-soft",
	"inset",
	"field",
	"track",
	"shelf",
	"hover",
	"hover-strong",
	"wash",
	"mark-fill",
];
const INK = [
	"ink",
	"ink-2",
	"ink-3",
	"ink-disabled",
	"ink-inverse",
	"ink-soft",
	"ink-meta",
];
const LINES = ["line", "line-strong", "line-soft"];
const ACTION = [
	"primary",
	"primary-hover",
	"primary-fg",
	"focus",
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
const SHADOWS = [
	"card",
	"control",
	"raised",
	"overlay",
	"primary",
	"destructive",
	"chip",
	"selected",
	"inset",
	"label",
	"float",
	"sheet",
	"contact",
];
// Full class names, so Tailwind sees each one in the source.
const BODY = [
	["xxs", "text-body-xxs"],
	["xs", "text-body-xs"],
	["s", "text-body-s"],
	["m", "text-body-m"],
	["l", "text-body-l"],
	["xl", "text-body-xl"],
	["xxl", "text-body-xxl"],
] as const;
const DISPLAY = [
	["xxs", "text-display-xxs"],
	["xs", "text-display-xs"],
	["s", "text-display-s"],
] as const;
const SPACE = ["xxs", "xs", "s", "m", "l", "xl", "xxl"] as const;
const CORNERS = [
	["xs", "corner-xs"],
	["s", "corner-s"],
	["m", "corner-m"],
	["l", "corner-l"],
	["xl", "corner-xl"],
	["full", "corner-full"],
] as const;
const MOTION = [
	[
		"--motion-quick-duration",
		"--motion-easing",
		"hover tints, a check appearing",
	],
	["--motion-duration", "--motion-easing", "small changes (theme)"],
	[
		"--motion-medium-duration",
		"--motion-easing",
		"fades, sheets, a panel's width",
	],
	["--motion-large-duration", "--motion-large-easing", "large changes (theme)"],
	["--motion-slow-duration", "--motion-strong-easing", "a chart drawing in"],
	[
		"--motion-duration",
		"--motion-strong-easing",
		"ease-strong: presses, entering",
	],
	[
		"--motion-duration",
		"--motion-drawer-easing",
		"ease-drawer: drawers, rails",
	],
	["--motion-duration", "--motion-wave-easing", "ease-wave: strips, loops"],
] as const;

const BUTTON_VARIANTS = [
	"default",
	"outline",
	"ghost",
	"destructive",
	"link",
	"toolbar",
] as const;
const BUTTON_SIZES = ["xs", "sm", "default"] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-l">
			<h2 className="text-body-m font-medium text-ink-3">{title}</h2>
			{children}
		</section>
	);
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-m">
			{label ? (
				<span className="w-24 shrink-0 font-data text-body-xs text-ink-3">
					{label}
				</span>
			) : null}
			{children}
		</div>
	);
}

function Swatches({ names }: { names: string[] }) {
	return (
		<div className="grid grid-cols-4 gap-m">
			{names.map((name) => (
				<div key={name} className="flex flex-col gap-xs">
					<div
						className="h-8 corner-xs shadow-inset"
						style={{ background: `var(--${name})` }}
					/>
					<span className="font-data text-body-xs text-ink-3">{name}</span>
				</div>
			))}
		</div>
	);
}

function Roles() {
	return (
		<Section title="Roles">
			<Row label="ground">
				<Swatches names={GROUND} />
			</Row>
			<Row label="ink">
				<Swatches names={INK} />
			</Row>
			<Row label="lines">
				<Swatches names={LINES} />
			</Row>
			<Row label="action">
				<Swatches names={ACTION} />
			</Row>
			<Row label="state">
				<Swatches names={STATE} />
			</Row>
		</Section>
	);
}

function Scales() {
	return (
		<Section title="Type, space, corners">
			{BODY.map(([step, style]) => (
				<Row key={step} label={`body-${step}`}>
					<span className={`${style} text-ink`}>Sessions this week</span>
				</Row>
			))}
			{DISPLAY.map(([step, style]) => (
				<Row key={step} label={`display-${step}`}>
					<span className={`font-display ${style} text-ink`}>Opaline</span>
				</Row>
			))}
			<Row label="space">
				{SPACE.map((step) => (
					<div key={step} className="flex flex-col items-center gap-xs">
						<div
							className="h-4 bg-accent"
							style={{ width: `var(--space-${step})` }}
						/>
						<span className="font-data text-body-xs text-ink-3">{step}</span>
					</div>
				))}
			</Row>
			<Row label="corner">
				{CORNERS.map(([step, corner]) => (
					<div key={step} className="flex flex-col items-center gap-xs">
						<div className={`size-10 bg-field shadow-inset ${corner}`} />
						<span className="font-data text-body-xs text-ink-3">{step}</span>
					</div>
				))}
			</Row>
			<Row label="squircle">
				<div className="size-16 bg-card shadow-card corner-m squircle:corner-xl corner-squircle" />
				<div className="size-16 bg-card shadow-overlay corner-s squircle:corner-l corner-squircle" />
			</Row>
		</Section>
	);
}

function Elevation() {
	return (
		<Section title="Elevation">
			<div className="grid grid-cols-4 gap-xl">
				{SHADOWS.map((name) => (
					<div key={name} className="flex flex-col items-center gap-s">
						<div
							className="h-10 w-full corner-s bg-card"
							style={{ boxShadow: `var(--shadow-${name})` }}
						/>
						<span className="font-data text-body-xs text-ink-3">{name}</span>
					</div>
				))}
			</div>
		</Section>
	);
}

function Motion() {
	return (
		<Section title="Motion (hover a bar)">
			{MOTION.map(([duration, easing, use]) => (
				<Row
					key={`${duration}${easing}`}
					label={duration.replace("--motion-", "")}
				>
					<div className="group h-2 w-40 corner-full bg-field">
						<div
							className="h-2 w-4 corner-full bg-ink transition-[width] group-hover:w-40"
							style={{
								transitionDuration: `var(${duration})`,
								transitionTimingFunction: `var(${easing})`,
							}}
						/>
					</div>
					<span className="text-body-m text-ink-3">{use}</span>
				</Row>
			))}
		</Section>
	);
}

function Buttons() {
	return (
		<Section title="Button">
			{BUTTON_VARIANTS.map((variant) => (
				<Row key={variant} label={variant}>
					{BUTTON_SIZES.map((size) => (
						<Button key={size} variant={variant} size={size}>
							<IconPlus />
							{size}
						</Button>
					))}
					<Button variant={variant} disabled>
						disabled
					</Button>
					<Button variant={variant} aria-invalid>
						invalid
					</Button>
				</Row>
			))}
			<Row label="toolbar states">
				<Button variant="toolbar" aria-pressed>
					<IconAdjustmentsHorizontal />
					pressed
				</Button>
				<Button variant="toolbar" data-active="">
					active
				</Button>
				<Button variant="toolbar" aria-expanded>
					open
					<IconChevronDown />
				</Button>
			</Row>
			<Row label="icon">
				<Button variant="outline" size="icon-xs" aria-label="Add">
					<IconPlus />
				</Button>
				<Button variant="outline" size="icon-sm" aria-label="Add">
					<IconPlus />
				</Button>
				<Button variant="ghost" size="icon" aria-label="Delete">
					<IconTrash />
				</Button>
				<span className="text-body-l text-ink-2">
					Couldn't load.{" "}
					<Button variant="link" size="inline">
						Try again
					</Button>
				</span>
			</Row>
		</Section>
	);
}

function Fields() {
	return (
		<Section title="Input, Checkbox, Label, Badge, Avatar">
			<Row label="input">
				<div className="w-48">
					<Input placeholder="Placeholder" />
				</div>
				<div className="w-48">
					<Input defaultValue="Invalid" aria-invalid />
				</div>
				<div className="w-48">
					<Input defaultValue="Disabled" disabled />
				</div>
			</Row>
			<Row label="checkbox">
				<Label>
					<Checkbox />
					Off
				</Label>
				<Label>
					<Checkbox defaultChecked />
					On
				</Label>
				<Label>
					<Checkbox disabled />
					Disabled
				</Label>
			</Row>
			<Row label="badge">
				<Badge>Secondary</Badge>
				<Badge variant="outline">Outline</Badge>
				<span className="inline-flex h-5 items-center corner-full bg-success-tint px-m text-body-m font-medium text-success">
					Passed
				</span>
				<span className="inline-flex h-5 items-center corner-full bg-warning-tint px-m text-body-m font-medium text-warning">
					Pending
				</span>
				<span className="inline-flex h-5 items-center corner-full bg-error-tint px-m text-body-m font-medium text-error">
					Failed
				</span>
			</Row>
			<Row label="avatar">
				<Avatar>
					<AvatarFallback>EV</AvatarFallback>
				</Avatar>
				<Avatar size="sm">
					<AvatarFallback>EV</AvatarFallback>
				</Avatar>
			</Row>
		</Section>
	);
}

function Surfaces() {
	return (
		<Section title="Card, Table, Empty, Separator">
			<Card>
				<CardHeader>
					<CardTitle>Card title</CardTitle>
					<CardDescription>A description in ink-3.</CardDescription>
				</CardHeader>
				<CardContent className="text-ink-2">Card content.</CardContent>
			</Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Repository</TableHead>
						<TableHead>Sessions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell>opaline</TableCell>
						<TableCell className="font-data tabular-nums">128</TableCell>
					</TableRow>
					<TableRow data-state="selected">
						<TableCell>selected row</TableCell>
						<TableCell className="font-data tabular-nums">42</TableCell>
					</TableRow>
				</TableBody>
			</Table>
			<Separator />
			<Empty>
				<EmptyHeader>
					<EmptyTitle>No sessions yet</EmptyTitle>
					<EmptyDescription>
						Sessions appear here once an agent runs.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</Section>
	);
}

function Patterns() {
	return (
		<Section title="Patterns (patterns.css)">
			<Row label="text-button">
				<button type="button" className="text-button">
					Rest
				</button>
				<button type="button" className="text-button" aria-pressed="true">
					Pressed
				</button>
				<button type="button" className="text-button" disabled>
					Disabled
				</button>
			</Row>
			<Row label="secondary">
				<button type="button" className="secondary-button">
					Secondary
				</button>
			</Row>
			<Row label="filter-chip">
				<span className="filter-chip">
					<span className="filter-chip-dimension">Model</span>
					opus
				</span>
				<span className="filter-chip" data-inactive="true">
					<span className="filter-chip-dimension">Repo</span>
					inactive
				</span>
			</Row>
			<Row label="InputGroup toolbar">
				<InputGroup variant="toolbar" className="w-56">
					<InputGroupAddon>
						<IconSearch />
					</InputGroupAddon>
					<InputGroupInput placeholder="Search" />
				</InputGroup>
			</Row>
			<Row label="form controls">
				<div className="flex w-64 flex-col gap-m">
					<Input className="form-input" placeholder="you@example.com" />
					<Button className="form-button">Continue</Button>
					<Button className="form-button" variant="outline">
						Continue with Google
					</Button>
				</div>
			</Row>
			<Row label="tab pills">
				<span className="tab-track inline-flex h-8 items-center corner-s px-l text-body-xl">
					On a track
				</span>
				<span className="tab-pill inline-flex h-8 items-center corner-s px-l text-body-xl">
					Lifted
				</span>
				<span className="inline-flex h-8 items-center corner-s bg-accent px-l text-body-xl text-accent-fg">
					accent-fg
				</span>
			</Row>
			<Row label="inset corner">
				<div className="relative size-16 corner-s bg-card shadow-card corner-squircle squircle:corner-xl">
					<div className="absolute inset-px corner-s-inset bg-hover-strong corner-squircle squircle:corner-xl-inset" />
				</div>
			</Row>
			<Row label="toolbar-search">
				<div className="relative w-56">
					<IconSearch
						aria-hidden="true"
						className="absolute top-1/2 left-l size-3.5 -translate-y-1/2 text-ink-3"
					/>
					<input className="toolbar-search" placeholder="Search sessions" />
				</div>
			</Row>
			<Row label="surface-card">
				<div className="surface-card w-56 p-xl text-body-xl text-ink">
					A surface card
				</div>
			</Row>
			<Row label="menu">
				<div className="menu-surface w-56 corner-s bg-surface shadow-overlay">
					<div className="menu-list">
						<div className="menu-heading">Sort by</div>
						<div className="menu-row" data-active="true">
							<IconCheck
								aria-hidden="true"
								className="menu-icon size-3.5 shrink-0"
							/>
							Active row
						</div>
						<div className="menu-row">
							<IconFolder
								aria-hidden="true"
								className="menu-icon size-3.5 shrink-0"
							/>
							Row
						</div>
						<div className="menu-separator" />
						<button type="button" className="menu-row" disabled>
							Disabled row
						</button>
					</div>
				</div>
			</Row>
			<div className="settings-group">
				<div className="settings-group-heading">
					<div className="settings-group-title">
						<h2>Settings group</h2>
						<p>Rows of label, description and control.</p>
					</div>
				</div>
				<div className="settings-group-rows surface-card">
					<div className="settings-row">
						<div className="settings-row-copy">
							<span>Row title</span>
							<span className="settings-row-description">A description.</span>
						</div>
					</div>
					<div className="settings-row">
						<div className="settings-row-copy">
							<span>Second row</span>
						</div>
					</div>
				</div>
			</div>
		</Section>
	);
}

function Specimen({ mode }: { mode: "light" | "dark" }) {
	// Sizes its frame to its own height, so the parent page scrolls as one.
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const node = ref.current;
		const frame = window.frameElement as HTMLIFrameElement | null;
		if (!node || !frame) return;
		const resize = () => {
			frame.style.height = `${node.scrollHeight}px`;
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	return (
		<div
			ref={ref}
			className="flex min-w-0 flex-col gap-[calc(var(--space-xxl)*4/3)] bg-canvas p-xxl font-body text-body-xl text-ink"
		>
			<h1 className="font-display text-display-xs text-ink">{mode}</h1>
			<Roles />
			<Scales />
			<Elevation />
			<Motion />
			<Buttons />
			<Fields />
			<Surfaces />
			<Patterns />
		</div>
	);
}

/** One mode in its own document: roles resolve on the root, so a nested
 *  `.dark` would only flip the few roles `.dark` redeclares. */
function ModeFrame({ mode }: { mode: "light" | "dark" }) {
	return (
		<iframe
			title={`Opaline system, ${mode}`}
			src={`/dev/design-system?mode=${mode}`}
			className="min-w-0 flex-1 border-0"
		/>
	);
}

export function DesignSystemPage() {
	const mode = new URLSearchParams(window.location.search).get("mode");
	const frameMode = mode === "light" || mode === "dark" ? mode : null;

	// Inside a frame, the root carries the frame's mode; restore it on leave.
	useLayoutEffect(() => {
		if (!frameMode) return;
		const root = document.documentElement;
		const wasDark = root.classList.contains("dark");
		root.classList.toggle("dark", frameMode === "dark");
		return () => {
			root.classList.toggle("dark", wasDark);
		};
	}, [frameMode]);

	if (frameMode) return <Specimen mode={frameMode} />;
	return (
		<main className="flex min-h-screen items-start bg-canvas">
			<ModeFrame mode="light" />
			<ModeFrame mode="dark" />
		</main>
	);
}
