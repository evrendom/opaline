import type { ReactNode } from "react";
import { FlowNumber } from "@/app/ui/flow-number";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/dashboard/card";
import { PLAIN_NUMBER } from "@/lib/figure";
import { cn } from "@/lib/utils";

export function SummarySection({
	anchor,
	aside,
	children,
	className,
	count,
	fill = false,
	title,
}: {
	anchor?: string;
	aside?: ReactNode;
	children: ReactNode;
	className?: string;
	count?: number;
	fill?: boolean;
	title: ReactNode;
}) {
	return (
		<Card
			data-summary-section={anchor}
			size="sm"
			className={cn("min-w-0 scroll-mt-4", className)}
		>
			<CardHeader className="flex flex-row items-baseline justify-between gap-4">
				<CardTitle>{title}</CardTitle>
				{aside ??
					(count !== undefined ? (
						<span className="text-sm text-muted-foreground tabular-nums">
							<FlowNumber value={count} format={PLAIN_NUMBER} />
						</span>
					) : null)}
			</CardHeader>
			<CardContent
				className={cn("flex min-w-0 flex-col gap-2", fill && "min-h-0 flex-1")}
			>
				{children}
			</CardContent>
		</Card>
	);
}
