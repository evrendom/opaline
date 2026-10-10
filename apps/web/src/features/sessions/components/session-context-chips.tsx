import {
	IconFolder,
	IconGitBranch,
	IconGitCommit,
	IconSparkles,
} from "@tabler/icons-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import {
	formatModelDisplayLabel,
	getModelBrandIconClassName,
} from "@/features/dashboard/components/dashboard-model-brand";
import {
	ContextChip,
	ContextChipSkeleton,
} from "@/features/shell/components/context-chip";
import { cn } from "@/lib/utils";
import type { buildSessionDetailViewModel } from "./session-detail-view-model";
import { SessionStat } from "./session-reader-stat";

type SessionDetailViewModel = ReturnType<typeof buildSessionDetailViewModel>;

export function getRepositoryLabel(
	viewModel: SessionDetailViewModel | undefined,
) {
	if (viewModel?.safeRepository) {
		return viewModel.safeRepository;
	}
	if (!viewModel?.safeProjectPath) {
		return "Unknown repository";
	}
	return (
		viewModel.safeProjectPath.replaceAll("\\", "/").split("/").at(-1) ??
		viewModel.safeProjectPath
	);
}

// The session's identity under the page breadcrumb, who ran it,
// where, and with which model.
export function SessionContextChips({
	avatarUrl,
	isLoading,
	viewModel,
}: {
	avatarUrl: string | undefined;
	isLoading: boolean;
	viewModel: SessionDetailViewModel | undefined;
}) {
	if (!viewModel) {
		// Pill-shaped placeholders so the page below doesn't shift when the
		// chips arrive.
		return isLoading ? (
			<div className="flex shrink-0 flex-wrap items-center gap-2 bg-(--dashboard-01-content-background) px-6 pt-1 pb-3">
				<ContextChipSkeleton className="w-28" />
				<ContextChipSkeleton className="w-36" />
				<ContextChipSkeleton className="w-32" />
			</div>
		) : null;
	}

	const {
		displayModel,
		safeGitBranch,
		safeGitSha,
		safeProjectPath,
		safeRepository,
		safeUserDisplayName,
	} = viewModel;
	const ModelIcon = getModelIconComponent(displayModel);

	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2 bg-(--dashboard-01-content-background) px-6 pt-1 pb-3">
			<ContextChip
				icon={
					<Avatar className="size-3.5 after:hidden">
						{avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
						<AvatarFallback className="text-[0.5rem]">
							{safeUserDisplayName.charAt(0).toUpperCase()}
						</AvatarFallback>
					</Avatar>
				}
				label={safeUserDisplayName}
				title={`Member: ${safeUserDisplayName}`}
			/>
			{safeRepository || safeProjectPath ? (
				<ContextChip
					icon={<IconFolder aria-hidden="true" />}
					label={getRepositoryLabel(viewModel)}
					title={`Repository: ${safeRepository ?? safeProjectPath}`}
				/>
			) : null}
			{safeGitBranch ? (
				<ContextChip
					icon={<IconGitBranch aria-hidden="true" />}
					label={safeGitBranch}
					title={`Branch: ${safeGitBranch}`}
				/>
			) : null}
			{safeGitSha ? (
				<ContextChip
					icon={<IconGitCommit aria-hidden="true" />}
					label={safeGitSha.slice(0, 8)}
					mono
					title={`Commit: ${safeGitSha}`}
				/>
			) : null}
			{displayModel ? (
				<ContextChip
					icon={
						ModelIcon ? (
							<ModelIcon className={getModelBrandIconClassName(displayModel)} />
						) : (
							<IconSparkles aria-hidden="true" />
						)
					}
					label={formatModelDisplayLabel(displayModel)}
					title={`Model: ${displayModel}`}
				/>
			) : null}
		</div>
	);
}

/** The same identity as fields in the reader's session rail, in its stats'
 * style — a label over each value — rather than chips. */
export function SessionContextFields({
	viewModel,
}: {
	viewModel: SessionDetailViewModel;
}) {
	const {
		displayModel,
		safeGitBranch,
		safeGitSha,
		safeProjectPath,
		safeRepository,
	} = viewModel;
	const ModelIcon = getModelIconComponent(displayModel);
	return (
		<>
			{safeRepository || safeProjectPath ? (
				<SessionStat
					label="Repository"
					title={safeRepository ?? safeProjectPath ?? undefined}
					value={getRepositoryLabel(viewModel)}
					valueClassName="truncate"
				/>
			) : null}
			{safeGitBranch ? (
				<SessionStat
					label="Branch"
					title={safeGitBranch}
					value={safeGitBranch}
					valueClassName="truncate"
				/>
			) : null}
			{safeGitSha ? (
				<SessionStat
					label="Commit"
					title={safeGitSha}
					value={safeGitSha.slice(0, 8)}
					valueClassName="font-mono text-xs"
				/>
			) : null}
			{displayModel ? (
				<SessionStat
					label="Model"
					title={displayModel}
					value={
						<span className="flex min-w-0 items-center gap-1.5">
							{ModelIcon ? (
								<ModelIcon
									className={cn(
										"size-3.5 shrink-0",
										getModelBrandIconClassName(displayModel),
									)}
								/>
							) : (
								<IconSparkles
									aria-hidden="true"
									className="size-3.5 shrink-0"
								/>
							)}
							<span className="truncate">
								{formatModelDisplayLabel(displayModel)}
							</span>
						</span>
					}
				/>
			) : null}
		</>
	);
}
