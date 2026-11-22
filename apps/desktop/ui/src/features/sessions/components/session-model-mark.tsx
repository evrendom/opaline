import { IconChevronRight, IconUser } from "@tabler/icons-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { ModelTraceIcon } from "@/components/conversation/conversation-trace-icons";
import {
	getModelBadgeTone,
	getModelBrandChip,
} from "@/features/dashboard/components/dashboard-model-brand";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { cn } from "@/lib/utils";
import { SessionMemberProfilePreview } from "./session-member-profile-preview";
import type { SessionMemberProfileSummary } from "./session-member-profile-summary";
import { SessionModelProgressRing } from "./session-model-progress-ring";

const MODEL_MARK_CLASS_NAME =
	"relative flex size-7 shrink-0 items-center justify-center";
const MODEL_BACKGROUND_CLASS_NAME =
	"absolute inset-0 [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]";
const MODEL_ICON_SHELL_CLASS_NAME =
	// design-escape-ok(shadow): the model icon's hairline edge is artwork
	"session-turn-table-model-icon-shell relative flex size-5 shrink-0 drop-shadow-[0_0_0.75px_rgb(0_0_0_/_14%)]";
const MODEL_ICON_CLASS_NAME =
	"session-turn-table-model-icon size-5 corner-zero edge-none bg-canvas shadow-none dark:bg-[color-mix(in_oklab,#fff_14%,var(--canvas))] [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]";

export function SessionModelLoadingMark() {
	return (
		<span
			aria-hidden="true"
			// design-escape-ok(colour): shipped value; #111 (white in dark)
			className={cn(MODEL_MARK_CLASS_NAME, "text-[#111] dark:text-white")}
		>
			<span className={cn(MODEL_BACKGROUND_CLASS_NAME, "bg-hover")}>
				<SessionModelProgressRing progress="loading" />
			</span>
			<span className={MODEL_ICON_SHELL_CLASS_NAME}>
				<span className={MODEL_ICON_CLASS_NAME} />
			</span>
		</span>
	);
}

export function SessionModelMark({
	avatarUrl,
	loading = false,
	model,
	memberProfile,
	progress,
	showMember = true,
	userLabel,
	disclosure,
}: {
	avatarUrl: string | undefined;
	/** The session is running right now: the band loads around the model,
	 * as it does while more sessions load, in place of its cost. */
	loading?: boolean;
	model: string;
	memberProfile?: SessionMemberProfileSummary;
	progress?: { label: string; value: number; maximumValue: number };
	showMember?: boolean;
	userLabel: string;
	/** On a session row that folds what's beneath it: the model glyph gives
	 * way to a chevron while the row is hovered or keyboard-focused, and the
	 * chevron stays, turned down, while it's open. */
	disclosure?: { open: boolean };
}) {
	const tone = getModelBadgeTone(model);
	const magnitude = progress
		? Math.min(
				100,
				Math.max(
					0,
					progress.maximumValue > 0
						? (progress.value / progress.maximumValue) * 100
						: 0,
				),
			)
		: null;
	const iconAccessibility = loading
		? { "aria-hidden": true as const }
		: progress && magnitude !== null
			? {
					role: "progressbar" as const,
					"aria-label": progress.label,
					"aria-valuemin": 0,
					"aria-valuemax": 100,
					"aria-valuenow": Math.round(magnitude),
				}
			: { "aria-hidden": true as const };
	const demo = useDemoRuntime();
	const userTitle = `Session owner: ${userLabel}`;
	const avatar = (
		<Avatar
			aria-label={userTitle}
			className="absolute -right-0.5 -bottom-0.5 size-3.5 cursor-help bg-canvas ring-1 ring-canvas after:border-line dark:after:border-line"
			role="img"
		>
			{avatarUrl ? (
				demo ? (
					<img
						alt=""
						data-slot="avatar-image"
						className="aspect-square size-full corner-full object-cover"
						src={avatarUrl}
					/>
				) : (
					<AvatarImage alt="" decoding="async" loading="lazy" src={avatarUrl} />
				)
			) : null}
			{!(demo && avatarUrl) ? (
				<AvatarFallback className="bg-canvas">
					<IconUser
						aria-hidden="true"
						className="size-2.5 shrink-0 text-ink-3"
					/>
				</AvatarFallback>
			) : null}
		</Avatar>
	);

	return (
		<div
			skullet-block=""
			className={cn(
				MODEL_MARK_CLASS_NAME,
				"corner-full",
				// design-escape-ok(colour): shipped value; #b96949
				tone.icon === "claude" && "text-[#b96949]",
				// design-escape-ok(colour): shipped value; #111 (white in dark)
				tone.icon === "codex" && "text-[#111] dark:text-white",
				tone.icon === null && "text-ink-3",
			)}
		>
			<span
				{...iconAccessibility}
				className={cn(
					MODEL_BACKGROUND_CLASS_NAME,
					// design-escape-ok(colour,opacity): shipped value; #cc7d5e/10
					tone.icon === "claude" && "bg-[#cc7d5e]/10",
					tone.icon !== "claude" && "bg-hover",
					progress && tone.identityIconClassName,
				)}
				data-session-model-background
				data-session-model-loading={loading ? "" : undefined}
				data-session-model-progress={progress && !loading ? "" : undefined}
			>
				{loading ? (
					<SessionModelProgressRing progress="loading" />
				) : magnitude !== null && magnitude > 0 ? (
					<SessionModelProgressRing progress={magnitude} />
				) : null}
			</span>
			<span
				aria-hidden="true"
				className={cn(
					MODEL_ICON_SHELL_CLASS_NAME,
					disclosure &&
						"grid place-items-center *:col-start-1 *:row-start-1 *:transition-[opacity,rotate,scale] *:duration-(--motion-duration) *:ease-out",
				)}
				data-session-detail-model-mark
			>
				<span
					className={cn(
						"flex",
						disclosure &&
							(disclosure.open
								? "scale-50 opacity-0"
								: "group-hover/session:scale-50 group-hover/session:opacity-0 group-focus-visible/session:scale-50 group-focus-visible/session:opacity-0"),
					)}
				>
					<ModelTraceIcon
						className="session-turn-table-model-icon"
						expandable={false}
						expanded={false}
						model={model}
					/>
				</span>
				{disclosure ? (
					<IconChevronRight
						className={cn(
							// The colour of the model glyph it stands in for.
							"size-3.5",
							getModelBrandChip(model)?.glyphClassName,
							disclosure.open
								? "rotate-90"
								: "scale-50 opacity-0 group-hover/session:scale-100 group-hover/session:opacity-100 group-focus-visible/session:scale-100 group-focus-visible/session:opacity-100",
						)}
					/>
				) : null}
			</span>
			{showMember &&
				(memberProfile ? (
					<SessionMemberProfilePreview
						avatarUrl={avatarUrl}
						profile={memberProfile}
						trigger={avatar}
						userLabel={userLabel}
					/>
				) : (
					avatar
				))}
		</div>
	);
}
