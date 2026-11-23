import { IconFolder, IconGitBranch, IconGitCommit } from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Bone, Reveal } from "@/app/ui/bones";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { ContextChip } from "@/features/shell/components/context-chip";
import { ModelChip } from "../reader/detail/waterfall/session-reader-waterfall-chips";
import { FactDot } from "../reader/subagents/session-reader-subagent-strip";
import type { buildSessionDetailViewModel } from "./session-detail-view-model";

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
	if (!viewModel && !isLoading) return null;
	return (
		<Reveal
			label="Loading where this session ran"
			loading={!viewModel}
			sample={
				<div className="flex shrink-0 flex-wrap items-center gap-m bg-canvas px-xxl pt-xs pb-l">
					<Bone className="h-8 w-28 corner-full" />
					<Bone className="h-8 w-36 corner-full" />
					<Bone className="h-8 w-32 corner-full" />
				</div>
			}
			sampleId="session-chips"
		>
			{() =>
				viewModel ? (
					<ContextChips avatarUrl={avatarUrl} viewModel={viewModel} />
				) : null
			}
		</Reveal>
	);
}

function ContextChips({
	avatarUrl,
	viewModel,
}: {
	avatarUrl: string | undefined;
	viewModel: SessionDetailViewModel;
}) {
	const {
		displayModel,
		safeGitBranch,
		safeGitSha,
		safeProjectPath,
		safeRepository,
		safeUserDisplayName,
	} = viewModel;

	return (
		<div className="flex shrink-0 flex-wrap items-center gap-m bg-canvas px-xxl pt-xs pb-l">
			<ContextChip
				icon={
					<Avatar size="sm" className="size-3.5 after:hidden">
						{avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
						<AvatarFallback>
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
					icon={<ModelChip model={displayModel} tip={false} />}
					label={formatModelDisplayLabel(displayModel)}
					title={`Model: ${displayModel}`}
				/>
			) : null}
		</div>
	);
}

export function SessionWhere({
	viewModel,
}: {
	viewModel: SessionDetailViewModel;
}) {
	const { safeGitBranch, safeGitSha, safeProjectPath, safeRepository } =
		viewModel;
	const parts: [string, ReactNode][] = [];
	if (safeRepository || safeProjectPath)
		parts.push([
			"repository",
			<span
				key="repository"
				className="max-w-48 truncate"
				title={safeRepository ?? safeProjectPath ?? undefined}
			>
				{getRepositoryLabel(viewModel)}
			</span>,
		]);
	if (safeGitBranch)
		parts.push([
			"branch",
			<span key="branch" className="max-w-56 truncate" title={safeGitBranch}>
				{safeGitBranch}
			</span>,
		]);
	if (safeGitSha)
		parts.push([
			"commit",
			<span key="commit" className="font-data" title={safeGitSha}>
				{safeGitSha.slice(0, 8)}
			</span>,
		]);
	return parts.map(([name, part], index) => (
		<Fragment key={name}>
			{index > 0 ? <FactDot /> : null}
			{part}
		</Fragment>
	));
}
