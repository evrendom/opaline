import type { CSSProperties } from "react";
import decimalEditionStampPng from "@/features/wrapped/assets/decimal-edition-stamp.png";
import decimalWordmarkSvg from "@/features/wrapped/assets/decimal-wordmark.svg";
import { cn } from "@/lib/utils";
import { WrappedTeamCardArtboardFrame } from "./artboard-frame";
import type {
	WrappedTeamMemberCardEdition,
	WrappedTeamMemberCardTheme,
} from "./card";

export interface WrappedTeamMemberCardBackMetric {
	label: string;
	slot?: "body" | "footer";
	value: string;
	valueTruncation?: "start";
}

export type WrappedTeamMemberCardBackVariant = "default" | "gradient-only";

export function WrappedTeamMemberCardBack(props: {
	backgroundOverlayClassName?: string;
	disableOuterShadow?: boolean;
	edition?: WrappedTeamMemberCardEdition;
	metrics: readonly WrappedTeamMemberCardBackMetric[];
	shellClassName?: string;
	shellStyle?: CSSProperties;
	theme?: WrappedTeamMemberCardTheme;
	variant?: WrappedTeamMemberCardBackVariant;
}) {
	const {
		backgroundOverlayClassName,
		disableOuterShadow = false,
		edition,
		metrics,
		shellClassName,
		shellStyle,
		theme = "light",
		variant = "default",
	} = props;
	const isDarkTheme = theme === "dark";
	const isMutedTheme = theme === "muted";
	const usesLightFooterInk = isDarkTheme;
	const shouldRenderContent = variant === "default";
	const bodyMetrics = metrics.filter((metric) => metric.slot !== "footer");
	const footerMetric =
		metrics.find((metric) => metric.slot === "footer") ?? null;
	const cardBackStyle = {
		"--wrapped-team-card-back-divider":
			isDarkTheme || isMutedTheme
				? "rgb(255 255 255 / 0.2)"
				: "rgb(23 22 28 / 0.18)",
		"--wrapped-team-card-back-muted":
			isDarkTheme || isMutedTheme
				? "rgb(255 247 239 / 0.74)"
				: "rgb(23 22 28 / 0.66)",
		"--wrapped-team-card-back-soft":
			isDarkTheme || isMutedTheme
				? "rgb(255 247 239 / 0.52)"
				: "rgb(23 22 28 / 0.48)",
		"--wrapped-team-card-back-footer-ink": usesLightFooterInk
			? "rgb(255 247 239 / 0.78)"
			: "rgb(23 22 28 / 0.74)",
	} as CSSProperties;
	const outerShadowStyle = {
		boxShadow: disableOuterShadow
			? "inset 0 calc(var(--wrapped-card-render-scale, 1) * 1px) 0 rgb(255 255 255 / 0.16)"
			: undefined,
	} as CSSProperties;

	return (
		<WrappedTeamCardArtboardFrame>
			<article
				data-testid="wrapped-team-card-back"
				className={cn(
					"rudel-wrapped-team-card-back",
					"relative isolate overflow-hidden",
					shellClassName,
					isDarkTheme ? "text-[#fff7ef]" : null,
					isMutedTheme ? "text-[#f6efe4]" : null,
				)}
				style={{ ...cardBackStyle, ...shellStyle, ...outerShadowStyle }}
			>
				{backgroundOverlayClassName ? (
					<div aria-hidden="true" className={backgroundOverlayClassName} />
				) : null}
				<div
					aria-hidden="true"
					className="rudel-wrapped-team-card-back__wash"
				/>
				{shouldRenderContent ? (
					<div className="rudel-wrapped-team-card-back__content">
						{edition === "decimal" ? (
							<WrappedTeamMemberCardBackEditionLockup />
						) : (
							<div className="rudel-wrapped-team-card-back__logo-shell">
								<WrappedTeamMemberCardBackLogo className="rudel-wrapped-team-card-back__logo" />
							</div>
						)}

						<div className="rudel-wrapped-team-card-back__metrics-shell">
							<table className="rudel-wrapped-team-card-back__metrics-table">
								<tbody>
									{bodyMetrics.map((metric) => (
										<WrappedTeamMemberCardBackMetricRow
											key={metric.label}
											metric={metric}
										/>
									))}
								</tbody>
							</table>
						</div>
						{footerMetric ? (
							<div className="rudel-wrapped-team-card-back__metric-footer-shell">
								<div className="rudel-wrapped-team-card-back__footer-lockup">
									<span className="rudel-wrapped-team-card-back__footer-date">
										{footerMetric.value}
									</span>
								</div>
							</div>
						) : null}
					</div>
				) : null}
			</article>
		</WrappedTeamCardArtboardFrame>
	);
}

function WrappedTeamMemberCardBackEditionLockup() {
	return (
		<div className="rudel-wrapped-team-card-back__edition-lockup">
			<div className="rudel-wrapped-team-card-edition-badge rudel-wrapped-team-card-edition-badge--back">
				<img
					alt=""
					aria-hidden="true"
					className="rudel-wrapped-team-card-edition-badge__stamp"
					decoding="sync"
					draggable={false}
					height={512}
					src={decimalEditionStampPng}
					width={512}
				/>
				<img
					alt=""
					aria-hidden="true"
					className="rudel-wrapped-team-card-edition-badge__wordmark"
					decoding="sync"
					draggable={false}
					height={18.576}
					src={decimalWordmarkSvg}
					width={212.62}
				/>
				<span className="sr-only">Decimals</span>
			</div>
			<span className="rudel-wrapped-team-card-back__edition-caption">
				MEMBER
			</span>
		</div>
	);
}

function WrappedTeamMemberCardBackLogo(props: { className?: string }) {
	const { className } = props;

	return (
		<svg
			aria-label="Opaline"
			className={className}
			fill="none"
			role="img"
			viewBox="0 0 1049 1042"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M524.532 0C661.725 4.52425 793.956 20.3892 890.19 103.494C986.746 183.313 1047.24 330.329 1049 520.65C1047.24 710.913 986.746 857.99 890.19 937.817C793.956 1020.92 661.79 1036.79 524.532 1041.3C387.274 1036.79 255.1 1020.92 158.866 937.817C62.3182 857.99 1.76716 711.006 0 520.684L0.00200081 520.672L0.010004 520.66L0.0200081 520.654L0.0320129 520.65L0.0560226 520.64L0.0640259 520.616C1.75876 330.245 62.3185 183.245 158.866 103.494C255.1 20.3892 387.274 4.52426 524.532 0ZM524.518 229.469C447.847 231.997 374.015 240.862 320.259 287.3C266.328 331.864 232.5 414.007 231.554 520.384L231.548 520.396L231.536 520.402L231.53 520.404L231.524 520.408L231.52 520.414L231.518 520.42C232.505 626.77 266.328 708.904 320.259 753.511C374.015 799.948 447.847 808.813 524.518 811.336C601.189 808.813 675.017 799.948 728.773 753.511C782.708 708.904 816.5 626.719 817.482 520.402C816.5 414.053 782.708 331.902 728.773 287.3C675.017 240.862 601.153 231.997 524.518 229.469Z"
				fill="currentColor"
			/>
		</svg>
	);
}

function WrappedTeamMemberCardBackMetricRow(props: {
	metric: WrappedTeamMemberCardBackMetric;
}) {
	const { metric } = props;

	return (
		<tr
			className={cn(
				"rudel-wrapped-team-card-back__metric-row",
				metric.valueTruncation === "start"
					? "rudel-wrapped-team-card-back__metric-row--value-truncate-start"
					: null,
			)}
		>
			<th scope="row" className="rudel-wrapped-team-card-back__metric-label">
				{metric.label}
			</th>
			<td className="rudel-wrapped-team-card-back__metric-value">
				<span
					className="rudel-wrapped-team-card-back__metric-value-text"
					title={metric.valueTruncation === "start" ? metric.value : undefined}
				>
					{metric.value}
				</span>
			</td>
		</tr>
	);
}
