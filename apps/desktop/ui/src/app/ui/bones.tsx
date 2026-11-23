import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { forgetShapes, smart } from "skullet";
import { Skeleton, SkulletProvider } from "skullet/react";
import {
	introRequested,
	markIntroContentReady,
	useIntroHold,
	useIntroPageReady,
	useIntroSettled,
} from "@/app/first-open";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { cn } from "@/lib/utils";
import "./bones.css";
import { cancelSkulletAnimations } from "./skullet-animations";

const THEME = {
	light: { base: "var(--bone)", highlight: "var(--bone-shine)" },
	animation: "shimmer" as const,
	radius: "0.25rem",
};

const INTRO_REVEAL = { ...smart, hold: 0 };

// skullet saves each skeleton's shapes in localStorage and redraws them on
// later visits, so a sample changed in code would never reach a returning
// user. A new build forgets the saved shapes once; each skeleton re-measures
// on its next draw.
const BUILD_KEY = "opaline:bones-build";
function forgetShapesFromOlderBuilds() {
	const build = import.meta.env.VITE_BUILD_ID;
	if (!build || typeof window === "undefined") return;
	try {
		if (window.localStorage.getItem(BUILD_KEY) === build) return;
		forgetShapes();
		window.localStorage.setItem(BUILD_KEY, build);
	} catch {
		// storage blocked: nothing was saved either
	}
}
forgetShapesFromOlderBuilds();

export function BonesProvider({ children }: { children: ReactNode }) {
	const holding = useIntroHold();
	return (
		<SkulletProvider
			mode="light"
			reveal={holding ? INTRO_REVEAL : "smart"}
			theme={THEME}
		>
			{children}
		</SkulletProvider>
	);
}

export function Bone({
	className,
	style,
}: {
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<span skullet-block="" className={cn("block", className)} style={style} />
	);
}

// skullet draws a reveal's bars in its layer's open shadow root, which page
// CSS doesn't reach: the sheet is adopted there, made first if skullet hasn't
// drawn yet, and skullet draws into the root it finds.
const squircleBars =
	typeof CSSStyleSheet !== "undefined" &&
	"replaceSync" in CSSStyleSheet.prototype
		? new CSSStyleSheet()
		: null;
squircleBars?.replaceSync("[skullet-rect] { corner-shape: squircle; }");

function useSquircleBars(bars?: CSSStyleSheet | null) {
	const host = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (!squircleBars || !host.current) return;
		for (const layer of host.current.querySelectorAll("[skullet-layer]")) {
			const root = layer.shadowRoot ?? layer.attachShadow({ mode: "open" });
			for (const sheet of bars ? [squircleBars, bars] : [squircleBars])
				if (!root.adoptedStyleSheets.includes(sheet))
					root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
		}
	});
	useEffect(() => {
		if (!host.current) return;
		return cancelSkulletAnimations(host.current);
	}, []);
	return host;
}

// skullet draws a loading reveal from the last content it showed under the
// same key, falling back to the sample only when it has none. A key only the
// sample ever uses keeps it drawing the sample: content is never saved there.
const sampleKey = (label: string) => `sample:${label}`;

// skullet snapshots shown content under its key after every DOM change (a deep
// clone plus a text measure of each node); an empty key turns that off.
const NO_SNAPSHOT = "";

export function Bones({
	children,
	className,
	fill = false,
	label,
}: {
	children: ReactNode;
	className?: string;
	fill?: boolean;
	label: string;
}) {
	const host = useSquircleBars();
	return (
		<div ref={host} className="contents">
			<Skeleton
				className={cn(fill && "bones-fill", className)}
				id={sampleKey(label)}
				label={label}
				loading
			>
				{children}
			</Skeleton>
		</div>
	);
}

export function Reveal({
	bars,
	barStyle,
	children,
	className,
	fill = false,
	label,
	loading,
	sample,
	sampleId,
}: {
	/** Extra rules for the drawn bars (they live in skullet's shadow root). */
	bars?: CSSStyleSheet | null;
	/** Custom properties those rules read, set where the bars inherit them. */
	barStyle?: CSSProperties;
	children: () => ReactNode;
	className?: string;
	fill?: boolean;
	label: string;
	loading: boolean;
	sample: ReactNode;
	sampleId: string;
}) {
	const host = useSquircleBars(bars);
	const skeleton = loading;
	return (
		<div ref={host} className="contents" style={barStyle}>
			<Skeleton
				className={cn(fill && "bones-fill", className)}
				id={skeleton ? sampleKey(sampleId) : NO_SNAPSHOT}
				label={label}
				loading={skeleton}
			>
				{skeleton ? sample : children()}
			</Skeleton>
		</div>
	);
}

function IntroSkeleton({
	children,
	className,
	label,
}: {
	children: ReactNode;
	className?: string;
	label: string;
}) {
	const host = useSquircleBars();
	const holding = useIntroHold();
	const settled = useIntroSettled();
	return (
		<div ref={host} className="contents">
			<Skeleton
				className={cn("intro-region", className)}
				label={label}
				loading={holding && settled}
			>
				<span skullet-own="" hidden />
				{children}
			</Skeleton>
		</div>
	);
}

function IntroContentReady() {
	useMountEffect(markIntroContentReady);
	return null;
}

function IntroPage({
	contentReady,
	...props
}: {
	children: ReactNode;
	className?: string;
	contentReady: boolean;
	label: string;
}) {
	useIntroPageReady();
	return (
		<>
			<IntroSkeleton {...props} />
			{contentReady ? <IntroContentReady /> : null}
		</>
	);
}

export function IntroReveal({
	children,
	className,
	contentReady = true,
	label,
	page = false,
}: {
	children: ReactNode;
	className?: string;
	contentReady?: boolean;
	label: string;
	page?: boolean;
}) {
	if (!introRequested()) return children;
	if (page)
		return (
			<IntroPage
				className={className}
				contentReady={contentReady}
				label={label}
			>
				{children}
			</IntroPage>
		);
	return (
		<IntroSkeleton className={className} label={label}>
			{children}
		</IntroSkeleton>
	);
}
