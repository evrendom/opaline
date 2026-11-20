import { IconList } from "@tabler/icons-react";
import { EmptyState } from "@/components/dashboard/page-parts";

export function BreakdownEmpty({ title }: { title: string }) {
	return (
		<div className="cost-breakdown-empty-state">
			<EmptyState icon={IconList} title={title} className="gap-l p-xl py-xxl" />
		</div>
	);
}
