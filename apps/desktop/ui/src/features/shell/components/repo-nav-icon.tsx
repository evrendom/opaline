import type { CSSProperties } from "react";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import {
	ShellNavIcon,
	type ShellNavTone,
} from "@/features/shell/components/shell-nav-icon";
import { shellRouteMap } from "@/features/shell/config/shell-routes";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { repositoryHue } from "./sidebar-repositories-model";

const REPOSITORY_TONE: ShellNavTone = {
	chip: "[--opal-fill:oklch(0.95_0.035_var(--repo-hue))] [--opal-ring:oklch(0.66_0.16_var(--repo-hue)/0.2)] drop-shadow-[0_1.5px_2px_oklch(0.66_0.16_var(--repo-hue)/0.25)] dark:[--opal-fill:oklch(0.28_0.08_var(--repo-hue))]",
	glyph:
		"text-[oklch(0.62_0.16_var(--repo-hue))] dark:text-[oklch(0.74_0.15_var(--repo-hue))]",
};

export function useRepositoryClock(): number | undefined {
	const demo = useDemoRuntime();
	return demo
		? Date.parse(`${demo.seed.dashboard.input.endDate}T23:59:59Z`)
		: undefined;
}

const PLUGIN = import.meta.env.MODE === "plugin";

export function useRepositoryHue(repoKey: string) {
	const now = useRepositoryClock();
	const navigation = useAnalyticsQuery({
		...orpc.analytics.repositories.navigation.queryOptions({}),
		enabled: !PLUGIN,
	});
	const list = useAnalyticsQuery({
		...orpc.analytics.repositories.list.queryOptions({}),
		enabled: PLUGIN,
	});
	const repositories = PLUGIN ? list.data : navigation.data;
	return repositories ? repositoryHue(repositories, repoKey, now) : null;
}

export type RepoUploadStatus = "uploading" | "live" | null;

export function RepoNavIcon({
	hue,
	active,
	status = null,
}: {
	hue: number | null;
	active: boolean;
	status?: RepoUploadStatus;
}) {
	const route = shellRouteMap.repos;
	return (
		<span
			className="relative inline-grid shrink-0"
			style={
				hue === null ? undefined : ({ "--repo-hue": hue } as CSSProperties)
			}
		>
			<ShellNavIcon
				icon={route.icon}
				activeIcon={route.activeIcon}
				active={active}
				tone={hue === null ? route.tone : REPOSITORY_TONE}
			/>
			{status ? (
				<RepoUploadDot
					live={status === "live"}
					className={cn(
						"absolute top-0 right-0 ring-[1.5px] ring-sidebar",
						// design-escape-ok: the live-upload dot keeps its emerald (brighter than success)
						!active && "bg-emerald-500/55",
					)}
				/>
			) : null}
		</span>
	);
}

function RepoUploadDot({
	live,
	className,
}: {
	live: boolean;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				// design-escape-ok: the live-upload dot keeps its emerald (brighter than success)
				"pointer-events-none size-1.5 shrink-0 corner-full bg-emerald-500",
				live && "animate-repo-live motion-reduce:animate-none",
				className,
			)}
		/>
	);
}
