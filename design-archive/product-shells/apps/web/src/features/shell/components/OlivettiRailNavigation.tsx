import { useDialKit } from "dialkit";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { RailLink } from "@/features/shell/components/shell-rail";
import { shellNavigationRoutes } from "@/features/shell/config/shell-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";

// Pixel mirrors of the CSS geometry vars in app-surface.css
// (--olivetti-rail-dock-height, -bottom-offset, -width, -shoulder-width).
// The silhouette is built as one pixel-space SVG path so the shoulder curves
// keep their aspect ratio at any viewport width and the cast shadow can run
// as a single uninterrupted stroke along the whole carved edge.
const DOCK_HEIGHT_REM = 2.75;
const BOTTOM_OFFSET_REM = 0.25;
const DOCK_MAX_WIDTH_REM = 17.5;
const DOCK_VIEWPORT_MARGIN_REM = 0.75;
const SHOULDER_MIN_WIDTH_REM = 2.75;
const SHOULDER_MAX_WIDTH_REM = 3.75;
const SHOULDER_WIDTH_RATIO = 0.13392857;

// The shoulder curve is authored in an 85x64 box.
const SHOULDER_BOX_WIDTH = 85;
const SHOULDER_BOX_HEIGHT = 64;

interface RailGeometry {
	width: number;
	height: number;
	stripTop: number;
	dockLeft: number;
	dockRight: number;
	shoulderWidth: number;
	leftLift: number;
	rightLift: number;
}

function buildRailEdgePath(geometry: RailGeometry) {
	const {
		width,
		height,
		stripTop,
		dockLeft,
		dockRight,
		shoulderWidth,
		leftLift,
		rightLift,
	} = geometry;
	const scaleX = shoulderWidth / SHOULDER_BOX_WIDTH;
	const scaleY = stripTop / SHOULDER_BOX_HEIGHT;
	const leftX = (x: number) => (dockLeft + x * scaleX).toFixed(2);
	const rightX = (x: number) => (dockRight - x * scaleX).toFixed(2);
	const y = (boxY: number) => (boxY * scaleY).toFixed(2);
	return [
		`M0 ${(height - leftLift).toFixed(2)}`,
		`L${dockLeft.toFixed(2)} ${stripTop}`,
		`C${leftX(13.7915)} ${y(64)} ${leftX(26.6905)} ${y(56.6952)} ${leftX(34)} ${y(45)}`,
		`L${leftX(50)} ${y(19)}`,
		`C${leftX(57.3095)} ${y(7.3048)} ${leftX(71.2084)} ${y(0.0003)} ${leftX(85)} 0`,
		`L${rightX(85)} 0`,
		`C${rightX(71.2084)} ${y(0.0003)} ${rightX(57.3095)} ${y(7.3048)} ${rightX(50)} ${y(19)}`,
		`L${rightX(34)} ${y(45)}`,
		`C${rightX(26.6905)} ${y(56.6952)} ${rightX(13.7915)} ${y(64)} ${rightX(0)} ${stripTop}`,
		`L${width} ${(height - rightLift).toFixed(2)}`,
	].join("");
}

function buildRailFillPath(geometry: RailGeometry) {
	return `${buildRailEdgePath(geometry)}L${geometry.width} ${geometry.height}L0 ${geometry.height}Z`;
}

// The window-side region above the carved edge, with enough headroom that
// blurring it never lets the far boundary's falloff reach the visible rail.
const WINDOW_REGION_HEADROOM = 160;

function buildWindowRegionPath(geometry: RailGeometry) {
	return `${buildRailEdgePath(geometry)}L${geometry.width} ${-WINDOW_REGION_HEADROOM}L0 ${-WINDOW_REGION_HEADROOM}Z`;
}

export function OlivettiRailNavigation() {
	const currentShellRoute = useCurrentShellRoute();
	const getShellRoutePath = useShellRoutePath();
	const clipId = `olivetti-rail-${useId().replace(/[^a-zA-Z0-9-]/g, "")}-clip`;
	const footerRef = useRef<HTMLElement | null>(null);
	const [railWidth, setRailWidth] = useState(0);
	const [remInPixels] = useState(
		() =>
			Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
			16,
	);
	const dialValues = useDialKit("Olivetti rail", {
		connections: {
			_collapsed: false,
			leftEndLift: [1.5, 0, 4, 0.25],
			rightEndLift: [1.5, 0, 4, 0.25],
		},
		castShadow: {
			_collapsed: false,
			scale: [0.25, 0.05, 1, 0.01],
		},
	});
	// The .dashboard-01-window ambient layer (0 16px 40px -28px) resolves to a
	// boundary lifted 12px inside the window with a 20px sigma. Scaling both
	// together preserves the lift/sigma ratio — identical darkness at the
	// edge, reach proportional to the rail's small surface instead of a
	// full-height window edge.
	const ambientLift = 12 * dialValues.castShadow.scale;
	const ambientBlur = 20 * dialValues.castShadow.scale;

	useLayoutEffect(() => {
		const node = footerRef.current;
		if (!node) {
			return;
		}

		if (typeof ResizeObserver === "undefined") {
			setRailWidth(node.getBoundingClientRect().width);
			return;
		}

		const observer = new ResizeObserver((entries) => {
			const entry = entries[entries.length - 1];
			if (entry) {
				setRailWidth(entry.contentRect.width);
			}
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const dockHeight = DOCK_HEIGHT_REM * remInPixels;
	const bottomOffset = BOTTOM_OFFSET_REM * remInPixels;
	const dockWidth = Math.min(
		DOCK_MAX_WIDTH_REM * remInPixels,
		railWidth - DOCK_VIEWPORT_MARGIN_REM * remInPixels,
	);
	const geometry: RailGeometry | null =
		railWidth > 0
			? {
					width: railWidth,
					height: dockHeight + bottomOffset,
					stripTop: dockHeight,
					dockLeft: (railWidth - dockWidth) / 2,
					dockRight: (railWidth + dockWidth) / 2,
					shoulderWidth: Math.min(
						Math.max(
							dockWidth * SHOULDER_WIDTH_RATIO,
							SHOULDER_MIN_WIDTH_REM * remInPixels,
						),
						SHOULDER_MAX_WIDTH_REM * remInPixels,
					),
					leftLift: dialValues.connections.leftEndLift,
					rightLift: dialValues.connections.rightEndLift,
				}
			: null;
	const edgePath = geometry ? buildRailEdgePath(geometry) : "";
	const fillPath = geometry ? buildRailFillPath(geometry) : "";
	const windowRegionPath = geometry ? buildWindowRegionPath(geometry) : "";

	return (
		<footer
			ref={footerRef}
			className="dashboard-01-bottom-rail dashboard-01-olivetti-rail"
		>
			<div
				aria-hidden="true"
				data-olivetti-rail-surface
				className="absolute inset-0"
			>
				{geometry ? (
					<svg
						aria-hidden="true"
						className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] overflow-visible"
						width={geometry.width}
						height={geometry.height}
					>
						<defs>
							<clipPath id={clipId}>
								<path d={fillPath} />
							</clipPath>
						</defs>
						<path d={fillPath} fill="var(--olivetti-rail-surface)" />
						{/* Inverse of the .dashboard-01-window box-shadow, deposited on
						    the rail side of the carved edge. Each layer fills the
						    window-side region, applies the box-shadow layer's offset as
						    a translate and its blur as blur/2 (box-shadow blur ≈ 2σ),
						    and is clipped to the rail. The ambient layer's negative
						    spread minus its offset becomes the upward "lift", which is
						    why only its faint tail reaches past the edge. */}
						<g clipPath={`url(#${clipId})`}>
							<path
								d={windowRegionPath}
								transform="translate(0 1)"
								fill="var(--olivetti-rail-cast-contact-color)"
								style={{ filter: "blur(1px)" }}
							/>
							<path
								d={windowRegionPath}
								transform={`translate(0 ${-ambientLift})`}
								fill="var(--olivetti-rail-cast-ambient-color)"
								style={{
									filter: `blur(${ambientBlur}px)`,
								}}
							/>
							<path
								d={edgePath}
								fill="none"
								stroke="var(--olivetti-rail-cast-ring-color)"
								strokeWidth={2}
							/>
						</g>
					</svg>
				) : null}
				<div className="absolute inset-x-0 bottom-0 h-[env(safe-area-inset-bottom)] bg-[var(--olivetti-rail-surface)]" />
			</div>
			<div className="absolute bottom-[env(safe-area-inset-bottom)] left-1/2 h-[var(--olivetti-rail-dock-height)] w-[var(--olivetti-rail-width)] -translate-x-1/2 -translate-y-(--olivetti-rail-bottom-offset)">
				<div className="pointer-events-auto absolute top-[var(--olivetti-rail-controls-top)] right-[var(--olivetti-rail-controls-inset)] left-[var(--olivetti-rail-controls-inset)] flex h-[var(--olivetti-rail-controls-height)] min-w-0 items-center bg-transparent">
					<nav
						aria-label="Primary"
						className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
					>
						<ul className="mx-auto flex w-max min-w-full list-none items-center justify-between [&>li]:!h-12 [&>li]:!w-10">
							{shellNavigationRoutes.map((route) => (
								<RailLink
									key={route.id}
									to={getShellRoutePath(route.path)}
									label={route.navLabel}
									shortcut={route.shortcut}
									comingSoon={route.comingSoon}
									placement="olivetti-rail"
									active={currentShellRoute.id === route.id}
								>
									{route.icon}
								</RailLink>
							))}
						</ul>
					</nav>
				</div>
			</div>
		</footer>
	);
}
