import { IconAlertCircle } from "@tabler/icons-react";
import { Button } from "@/app/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/ui/card";
import { Skeleton } from "@/app/ui/skeleton";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { TeamMemberOverviewTable } from "@/features/team/components/TeamMemberOverviewTable";
import {
	type TeamPageDiagnostics,
	useTeamPageData,
} from "@/features/team/use-team-page-data";
import { cn } from "@/lib/utils";

const teamTableRowSkeletonKeys = [
	"row-alpha",
	"row-bravo",
	"row-charlie",
	"row-delta",
	"row-echo",
	"row-foxtrot",
] as const;

function TeamPageSkeleton() {
	return (
		<div className="-mx-4 overflow-hidden lg:-mx-6">
			{/* The toolbar's search and sort. */}
			<div className="flex h-12 items-center gap-2 px-6">
				<Skeleton className="h-8 w-56 rounded-full" />
				<Skeleton className="h-8 w-36 rounded-full" />
			</div>
			<div className="min-w-272 px-8">
				{teamTableRowSkeletonKeys.map((rowKey) => (
					<div
						key={rowKey}
						className="grid h-16 grid-cols-[24fr_21fr_16fr_9fr_10fr_9fr_11fr] items-center"
					>
						<div className="flex items-center gap-3 pr-3">
							<Skeleton className="size-8 shrink-0 rounded-full" />
							<div className="grid gap-1.5">
								<Skeleton className="h-3.5 w-28 rounded-sm" />
								<Skeleton className="h-3 w-16 rounded-sm" />
							</div>
						</div>
						<div className="flex gap-1.5 px-3">
							<Skeleton className="h-6 w-20 rounded-md" />
							<Skeleton className="h-6 w-16 rounded-md" />
						</div>
						<div className="px-3">
							<Skeleton className="h-7 w-32 rounded-sm" />
						</div>
						<div className="flex justify-end px-3">
							<Skeleton className="h-3.5 w-14 rounded-sm" />
						</div>
						<div className="flex justify-end px-3">
							<Skeleton className="h-3.5 w-12 rounded-sm" />
						</div>
						<div className="flex justify-end px-3">
							<Skeleton className="h-3.5 w-12 rounded-sm" />
						</div>
						<div className="flex justify-end pl-3">
							<Skeleton className="h-3.5 w-20 rounded-sm" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}

	return "We couldn't load the team roster for this workspace.";
}

const PRODUCTION_ERROR_MESSAGE =
	"We couldn't load the team roster for this workspace. Try again, or contact support if the problem continues.";

function getErrorRequestId(error: unknown) {
	if (
		typeof error !== "object" ||
		error === null ||
		!("data" in error) ||
		typeof error.data !== "object" ||
		error.data === null ||
		!("requestId" in error.data) ||
		typeof error.data.requestId !== "string"
	) {
		return null;
	}

	return error.data.requestId;
}

function getErrorDebugValue(error: unknown) {
	if (error instanceof Error) {
		return JSON.stringify(
			{
				name: error.name,
				message: error.message,
				stack: error.stack,
			},
			null,
			2,
		);
	}

	if (error === null || error === undefined) {
		return null;
	}

	try {
		return JSON.stringify(error, null, 2);
	} catch {
		return String(error);
	}
}

function TeamPageError({
	diagnostics,
	error,
	onRetry,
}: {
	diagnostics: TeamPageDiagnostics;
	error: unknown;
	onRetry: () => Promise<unknown>;
}) {
	const isDevelopment = import.meta.env.DEV;
	const debugValue = isDevelopment ? getErrorDebugValue(error) : null;
	const message = isDevelopment
		? getErrorMessage(error)
		: PRODUCTION_ERROR_MESSAGE;
	const requestId = getErrorRequestId(error);

	return (
		<Card
			size="sm"
			className="mx-auto max-w-2xl bg-card/95 shadow-none ring-1 ring-border/60"
		>
			<CardHeader className="gap-3">
				<div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
					<IconAlertCircle className="size-5" />
				</div>
				<div className="flex flex-col gap-1">
					<CardTitle>Team roster unavailable</CardTitle>
					<CardDescription>{message}</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{requestId ? (
					<p className="text-sm text-muted-foreground">
						Support reference:{" "}
						<code className="font-mono text-xs text-foreground">
							{requestId}
						</code>
					</p>
				) : null}
				{isDevelopment ? (
					<Card
						size="sm"
						className="bg-muted/20 shadow-none ring-1 ring-border/60"
					>
						<CardContent className="grid gap-2 text-sm">
							<div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
								<span className="text-muted-foreground">Endpoint</span>
								<span className="font-medium text-foreground">
									{diagnostics.endpoint}
								</span>
							</div>
							<div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
								<span className="text-muted-foreground">Workspace</span>
								<span className="font-medium text-foreground">
									{diagnostics.organizationName ?? "No active workspace"}
								</span>
							</div>
							<div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
								<span className="text-muted-foreground">Org ID</span>
								<span className="break-all font-mono text-[12px] text-foreground/80">
									{diagnostics.organizationId ?? "None"}
								</span>
							</div>
							<div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
								<span className="text-muted-foreground">Date range</span>
								<span className="font-medium text-foreground">
									{diagnostics.startDate} {"->"} {diagnostics.endDate}
								</span>
							</div>
							<div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
								<span className="text-muted-foreground">Computed days</span>
								<span className="font-medium text-foreground">
									{diagnostics.days}
									{diagnostics.requestedDays !== diagnostics.days
										? ` (query uses ${diagnostics.requestedDays})`
										: ""}
								</span>
							</div>
						</CardContent>
					</Card>
				) : null}
				<div className="flex items-center gap-3">
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							void onRetry();
						}}
					>
						Retry query
					</Button>
				</div>
				{debugValue ? (
					<details className="rounded-xl bg-muted/20 p-4 ring-1 ring-border/60">
						<summary className="cursor-pointer text-sm font-medium text-foreground">
							Raw error details
						</summary>
						<pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-[10px] bg-muted/60 p-3 font-mono text-[12px] text-foreground/85">
							{debugValue}
						</pre>
					</details>
				) : null}
			</CardContent>
		</Card>
	);
}

function TeamPageEmpty() {
	return (
		<Card
			size="sm"
			className="mx-auto max-w-xl bg-card/95 shadow-none ring-1 ring-border/60"
		>
			<CardContent className="px-6 py-10 text-center">
				<h2 className="text-base font-semibold text-foreground">
					No team members available
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					Add teammates to this workspace to populate the team roster.
				</p>
			</CardContent>
		</Card>
	);
}

export function TeamPage() {
	const {
		canInviteTeamMembers,
		diagnostics,
		error,
		isError,
		isPending,
		teamMemberRows,
		refetch,
		teamCards,
	} = useTeamPageData();
	let content = (
		<TeamMemberOverviewTable
			canInviteTeamMembers={canInviteTeamMembers}
			organizationId={diagnostics.organizationId}
			rows={teamMemberRows}
		/>
	);

	if (isPending) {
		content = <TeamPageSkeleton />;
	} else if (isError) {
		content = (
			<TeamPageError
				diagnostics={diagnostics}
				error={error}
				onRetry={refetch}
			/>
		);
	} else if (
		!canInviteTeamMembers &&
		teamMemberRows.length === 0 &&
		(teamCards?.length ?? 0) === 0
	) {
		content = <TeamPageEmpty />;
	}

	return (
		// The sessions list's palette, not its ground: painted, it would cover
		// the shell window's inset edge beside the roster but not in the
		// page's padding, leaving stray bits of it. The page scrolls itself.
		<div
			className={cn(
				SESSION_OVERVIEW_SURFACE_CLASS_NAME,
				"gap-4 overflow-visible bg-transparent px-4 lg:px-6",
			)}
		>
			{content}
		</div>
	);
}
