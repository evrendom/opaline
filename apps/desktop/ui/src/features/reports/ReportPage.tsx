import { IconFileSearch, IconLock } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Skeleton } from "@/app/ui/skeleton";
import { PageEmptyState } from "@/components/dashboard/page-parts";
import { RetryButton } from "@/components/retry-button";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { orpc } from "@/lib/orpc";
import { ReportView } from "./report-view";

const UNRETRIED_CODES = new Set([
	"NOT_FOUND",
	"FORBIDDEN",
	"UNAUTHORIZED",
	"PRECONDITION_FAILED",
	"BAD_REQUEST",
]);

export function ReportPage() {
	const { workspaceSlug = "", analysisId = "" } = useParams();
	const { userMap } = useUserMap();
	const report = useQuery({
		...orpc.analysis.history.report.queryOptions({
			input: { analysis: analysisId },
		}),
		retry: (failures, error) =>
			!UNRETRIED_CODES.has(errorCode(error) ?? "") && failures < 2,
	});

	if (report.isPending) return <ReportSkeleton />;
	if (report.isError) {
		const code = errorCode(report.error);
		if (code === "NOT_FOUND" || code === "BAD_REQUEST")
			return (
				<PageEmptyState
					icon={IconFileSearch}
					title="Report not found"
					description="This analysis does not exist in this workspace, or it has not been shared with you."
				/>
			);
		if (code === "FORBIDDEN" || code === "UNAUTHORIZED")
			return (
				<PageEmptyState
					icon={IconLock}
					title="You can't open this report"
					description="Ask its author to share it with the workspace."
				/>
			);
		return (
			<PageEmptyState
				icon={IconFileSearch}
				title="The report couldn't be loaded"
				description={
					code === "PRECONDITION_FAILED"
						? report.error.message
						: "Try loading it again."
				}
				action={
					<RetryButton
						onRetry={() => {
							void report.refetch();
						}}
					/>
				}
			/>
		);
	}
	return (
		<ReportView
			report={report.data}
			authorName={
				userMap[report.data.authorId] ?? (report.data.mine ? "you" : null)
			}
			workspaceSlug={workspaceSlug}
		/>
	);
}

function ReportSkeleton() {
	return (
		<main
			aria-label="Loading report"
			className="mx-auto flex w-full max-w-3xl flex-col gap-xl px-xxl py-[calc(var(--space-xxl)*5/3)]"
		>
			<Skeleton className="h-3 w-24 corner-xs" />
			<Skeleton className="h-6 w-2/3 corner-xs" />
			<Skeleton className="h-4 w-1/2 corner-xs" />
			<Skeleton className="mt-xl h-32 w-full corner-s" />
		</main>
	);
}

function errorCode(error: unknown): string | null {
	return error && typeof error === "object" && "code" in error
		? String(error.code)
		: null;
}
