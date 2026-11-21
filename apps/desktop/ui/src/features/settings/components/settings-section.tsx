import type * as React from "react";
import { Card } from "@/app/ui/card";
import { cn } from "@/lib/utils";
import "./settings-section.css";

export function SettingsSectionCard({
	className,
	size = "sm",
	...props
}: React.ComponentProps<typeof Card>) {
	return (
		<Card
			size={size}
			className={cn(
				"surface-card ring-0 data-[size=sm]:gap-xl data-[size=sm]:py-xl",
				className,
			)}
			{...props}
		/>
	);
}
