import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { ModelTraceIcon } from "@/components/conversation/conversation-trace-icons";
import { getModelBadgeTone } from "@/features/dashboard/components/dashboard-model-brand";
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
	"session-turn-table-model-icon-shell relative flex size-5 shrink-0 drop-shadow-[0_0_0.75px_rgb(0_0_0_/_14%)]";
const MODEL_ICON_CLASS_NAME =
	"session-turn-table-model-icon size-5 rounded-none border-0 bg-white shadow-none [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]";

export function SessionModelLoadingMark() {
	return (
		<span
			aria-hidden="true"
			className={cn(MODEL_MARK_CLASS_NAME, "text-[#111] dark:text-white")}
		>
			<span
				className={cn(
					MODEL_BACKGROUND_CLASS_NAME,
					"bg-black/4 dark:bg-white/8",
				)}
			>
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
	model,
	memberProfile,
	progress,
	showMember = true,
	userLabel,
}: {
	avatarUrl: string | undefined;
	model: string;
	memberProfile?: SessionMemberProfileSummary;
	progress?: { label: string; value: number; maximumValue: number };
	showMember?: boolean;
	userLabel: string;
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
	const iconAccessibility =
		progress && magnitude !== null
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
			className="absolute -right-0.5 -bottom-0.5 size-3.5 cursor-help bg-(--session-overview-surface) ring-1 ring-(--session-overview-surface) after:border-black/5 dark:after:border-white/10"
			role="img"
		>
			{avatarUrl ? (
				demo ? (
					<img
						alt=""
						data-slot="avatar-image"
						className="aspect-square size-full rounded-full object-cover"
						src={avatarUrl}
					/>
				) : (
					<AvatarImage alt="" decoding="async" loading="lazy" src={avatarUrl} />
				)
			) : null}
			{!(demo && avatarUrl) ? (
				<AvatarFallback className="bg-(--session-overview-surface)">
					<User
						aria-hidden="true"
						className="size-2.5 shrink-0 stroke-(--session-overview-muted)"
					/>
				</AvatarFallback>
			) : null}
		</Avatar>
	);

	return (
		<div
			className={cn(
				MODEL_MARK_CLASS_NAME,
				tone.icon === "claude" && "text-[#b96949]",
				tone.icon === "codex" && "text-[#111] dark:text-white",
				tone.icon === null && "text-(--session-overview-muted)",
			)}
		>
			<span
				{...iconAccessibility}
				className={cn(
					MODEL_BACKGROUND_CLASS_NAME,
					tone.icon === "claude" && "bg-[#cc7d5e]/10",
					tone.icon !== "claude" && "bg-black/4 dark:bg-white/8",
					progress && tone.identityIconClassName,
				)}
				data-session-model-background
				data-session-model-progress={progress ? "" : undefined}
			>
				{magnitude !== null && magnitude > 0 ? (
					<SessionModelProgressRing progress={magnitude} />
				) : null}
			</span>
			<span
				aria-hidden="true"
				className={MODEL_ICON_SHELL_CLASS_NAME}
				data-session-detail-model-mark
			>
				<ModelTraceIcon
					className={MODEL_ICON_CLASS_NAME}
					expandable={false}
					expanded={false}
					model={model}
				/>
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
