import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { smart } from "skullet";
import { Skeleton, SkulletProvider } from "skullet/react";
import { useIntroHold } from "@/app/first-open";
import { cn } from "@/lib/utils";
import "./bones.css";
import { cancelSkulletAnimations } from "./skullet-animations";

const THEME = {
	light: { base: "var(--bone)", highlight: "var(--bone-shine)" },
	animation: "shimmer" as const,
	radius: "0.25rem",
};

const INTRO_REVEAL = { ...smart, hold: 0 };

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

function useSquircleBars() {
	const host = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (!squircleBars || !host.current) return;
		for (const layer of host.current.querySelectorAll("[skullet-layer]")) {
			const root = layer.shadowRoot ?? layer.attachShadow({ mode: "open" });
			if (!root.adoptedStyleSheets.includes(squircleBars))
				root.adoptedStyleSheets = [...root.adoptedStyleSheets, squircleBars];
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
	children,
	className,
	fill = false,
	label,
	loading,
	sample,
	sampleId,
}: {
	children: () => ReactNode;
	className?: string;
	fill?: boolean;
	label: string;
	loading: boolean;
	sample: ReactNode;
	sampleId: string;
}) {
	const host = useSquircleBars();
	const holding = useIntroHold();
	const skeleton = loading || holding;
	return (
		<div ref={host} className="contents">
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
