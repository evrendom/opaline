import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { ModelTraceIcon } from "@/components/conversation/conversation-trace-icons";
import { getModelBadgeTone } from "@/features/dashboard/components/dashboard-model-brand";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { cn } from "@/lib/utils";
import { SessionMemberProfilePreview } from "./session-member-profile-preview";
import type { SessionMemberProfileSummary } from "./session-member-profile-summary";

// The existing trace silhouette scaled to the center of its 4px background band.
const MODEL_BAND_PATH =
	"M14 2.08C17.14 2.18 20.16 2.55 22.37 4.45C24.58 6.27 25.96 9.64 26 13.99C25.96 18.35 24.58 21.71 22.37 23.54C20.16 25.44 17.14 25.8 14 25.9C10.86 25.8 7.84 25.44 5.63 23.54C3.43 21.71 2.04 18.35 2 13.99C2.04 9.64 3.43 6.27 5.63 4.45C7.84 2.55 10.86 2.18 14 2.08Z";

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
				"relative flex size-7 shrink-0 items-center justify-center",
				tone.icon === "claude" && "text-[#b96949]",
				tone.icon === "codex" && "text-[#111] dark:text-white",
				tone.icon === null && "text-(--session-overview-muted)",
			)}
		>
			<span
				{...iconAccessibility}
				className={cn(
					"absolute inset-0 [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]",
					tone.icon === "claude" && "bg-[#cc7d5e]/10",
					tone.icon !== "claude" && "bg-black/4 dark:bg-white/8",
					progress && tone.identityIconClassName,
				)}
				data-session-model-background
				data-session-model-progress={progress ? "" : undefined}
			>
				{magnitude !== null && magnitude > 0 ? (
					<svg aria-hidden="true" className="size-full" viewBox="0 0 28 28">
						<path
							d={MODEL_BAND_PATH}
							fill="none"
							pathLength={100}
							stroke="currentColor"
							strokeDasharray={magnitude < 100 ? `${magnitude} 100` : undefined}
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={3}
						/>
					</svg>
				) : null}
			</span>
			<span
				aria-hidden="true"
				className="session-turn-table-model-icon-shell relative flex size-5 shrink-0 drop-shadow-[0_0_0.75px_rgb(0_0_0_/_14%)]"
				data-session-detail-model-mark
			>
				<ModelTraceIcon
					className="session-turn-table-model-icon size-5 rounded-none border-0 bg-white shadow-none [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]"
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
