import type * as React from "react";
import { Card } from "@/app/ui/card";
import { cn } from "@/lib/utils";
import "./settings-section.css";

export function SettingsSectionStack({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"mx-auto flex w-full max-w-160 flex-col gap-8 pb-12",
				className,
			)}
			{...props}
		/>
	);
}

export function SettingsSectionCard({
	className,
	size = "sm",
	...props
}: React.ComponentProps<typeof Card>) {
	return (
		<Card
			size={size}
			className={cn("settings-section-surface py-4 ring-0", className)}
			{...props}
		/>
	);
}
