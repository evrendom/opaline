import { IconFileSearch, IconLock } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Button } from "@/app/ui/button";
import { Skeleton } from "@/app/ui/skeleton";
import { UsageStateMessage } from "@/components/usage-collection-view";
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
				<UsageStateMessage
					icon={<IconFileSearch aria-hidden="true" />}
					title="Report not found"
					description="This analysis does not exist in this workspace, or it has not been shared with you."
				/>
			);
		if (code === "FORBIDDEN" || code === "UNAUTHORIZED")
			return (
				<UsageStateMessage
					icon={<IconLock aria-hidden="true" />}
					title="You can't open this report"
					description="Ask its author to share it with the workspace."
				/>
			);
		return (
			<UsageStateMessage
				icon={<IconFileSearch aria-hidden="true" />}
				title="The report couldn't be loaded"
				description={
					code === "PRECONDITION_FAILED"
						? report.error.message
						: "Try loading it again."
				}
				action={
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => {
							void report.refetch();
						}}
					>
						Try again
					</Button>
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
			className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10"
		>
			<Skeleton className="h-3 w-24 rounded-sm" />
			<Skeleton className="h-6 w-2/3 rounded-sm" />
			<Skeleton className="h-4 w-1/2 rounded-sm" />
			<Skeleton className="mt-4 h-32 w-full rounded-md" />
		</main>
	);
}

function errorCode(error: unknown): string | null {
	return error && typeof error === "object" && "code" in error
		? String(error.code)
		: null;
}
