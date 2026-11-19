import { IconList } from "@tabler/icons-react";
import { EmptyState } from "@/components/dashboard/page-parts";

export function BreakdownEmpty({ title }: { title: string }) {
	return (
		<div className="cost-breakdown-empty-state">
			<EmptyState icon={IconList} title={title} className="gap-3 p-4 py-6" />
		</div>
	);
}
