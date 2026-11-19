import type { ComponentType, ReactNode } from "react";
import {
	getModelBadgeTone,
	getModelBrandChip,
} from "@/features/dashboard/components/dashboard-model-brand";
import { ModelChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import { cn } from "@/lib/utils";
import type { ToolIconName } from "./conversation-tools";
import {
	TraceChevronDownIcon,
	TraceUserIcon,
} from "./conversation-trace-glyphs";

const iconShellClassName =
	"flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-[color:var(--dashboardy-border)] text-[color:var(--dashboardy-muted)]";

export type TraceIconTone =
	| "amber"
	| "blue"
	| "claude"
	| "cyan"
	| "grass"
	| "neutral"
	| "openai"
	| "tomato"
	| "violet";

export function TraceIcon({
	icon: Icon,
	className,
	toolIcon,
	tone = "neutral",
}: {
	icon: ComponentType<{ className?: string }>;
	className?: string;
	toolIcon?: ToolIconName;
	tone?: TraceIconTone;
}) {
	return (
		<span
			className={cn(iconShellClassName, className)}
			data-trace-icon
			data-trace-icon-tone={tone}
			data-trace-tool-icon={toolIcon}
		>
			<Icon className="size-3.5" />
		</span>
	);
}

function TraceDisclosureFrame({
	bare = false,
	children,
	className,
	expanded,
	expandable,
	toolIcon,
	tone,
}: {
	bare?: boolean;
	children: ReactNode;
	className?: string;
	expanded: boolean;
	expandable: boolean;
	toolIcon?: ToolIconName;
	tone?: TraceIconTone;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn("relative overflow-hidden", className)}
			data-trace-icon={tone && !bare ? "" : undefined}
			data-trace-icon-tone={tone}
			data-trace-tool-icon={toolIcon}
		>
			<span
				className={cn(
					"flex size-full items-center justify-center",
					expandable && "group-hover:invisible group-focus-visible:invisible",
				)}
				data-trace-disclosure-symbol="icon"
			>
				{children}
			</span>
			{expandable ? (
				<TraceChevronDownIcon
					className={cn(
						"pointer-events-none absolute inset-0 m-auto size-3 shrink-0 invisible group-hover:visible group-focus-visible:visible",
						!expanded && "-rotate-90",
					)}
					data-trace-disclosure-symbol="chevron"
				/>
			) : null}
		</span>
	);
}

export function TraceDisclosureIcon({
	icon: Icon,
	className,
	expanded,
	expandable,
	toolIcon,
	tone = "neutral",
}: {
	icon: ComponentType<{ className?: string }>;
	className?: string;
	expanded: boolean;
	expandable: boolean;
	toolIcon?: ToolIconName;
	tone?: TraceIconTone;
}) {
	return (
		<TraceDisclosureFrame
			className={cn(iconShellClassName, className)}
			expanded={expanded}
			expandable={expandable}
			toolIcon={toolIcon}
			tone={tone}
		>
			<Icon className="size-3.5" />
		</TraceDisclosureFrame>
	);
}

export function ModelTraceIcon({
	className,
	expanded,
	expandable = true,
	model,
}: {
	className?: string;
	expanded: boolean;
	expandable?: boolean;
	model: string | undefined;
}) {
	const modelBrand = model ? getModelBadgeTone(model).icon : null;
	const modelTone: TraceIconTone =
		modelBrand === "claude"
			? "claude"
			: modelBrand === "codex"
				? "openai"
				: "violet";

	return (
		<TraceDisclosureFrame
			bare
			className={cn(
				"flex size-5 shrink-0 items-center justify-center overflow-visible",
				getModelBrandChip(model)?.glyphClassName,
				className,
			)}
			expanded={expanded}
			expandable={expandable}
			tone={modelTone}
		>
			<ModelChip chip="size-5" model={model} tip={false} />
		</TraceDisclosureFrame>
	);
}

export function UserTraceAvatar({
	className,
	expanded,
	expandable,
	imageUrl,
}: {
	className?: string;
	expanded: boolean;
	expandable: boolean;
	imageUrl: string | undefined;
}) {
	return (
		<span
			className={cn(
				"relative flex size-5 shrink-0 drop-shadow-[0_0_0.75px_rgb(0_0_0_/_14%)]",
				className,
			)}
			data-user-trace-avatar-shell
		>
			<TraceDisclosureFrame
				className="flex size-full items-center justify-center rounded-full text-[color:var(--dashboardy-muted)]"
				expanded={expanded}
				expandable={expandable}
			>
				{imageUrl ? (
					<img
						src={imageUrl}
						alt=""
						width={20}
						height={20}
						className="size-full rounded-full object-cover"
					/>
				) : (
					<TraceUserIcon className="size-3" />
				)}
			</TraceDisclosureFrame>
		</span>
	);
}
