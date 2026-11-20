import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Avatar({
	className,
	size = "default",
	...props
}: AvatarPrimitive.Root.Props & {
	size?: "default" | "sm";
}) {
	return (
		<AvatarPrimitive.Root
			data-slot="avatar"
			data-size={size}
			className={cn(
				"group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:shadow-(--shadow-card) after:mix-blend-darken data-[size=sm]:size-6 dark:after:mix-blend-lighten",
				className,
			)}
			{...props}
		/>
	);
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
	return (
		<AvatarPrimitive.Image
			data-slot="avatar-image"
			className={cn(
				"aspect-square size-full rounded-full object-cover",
				className,
			)}
			{...props}
		/>
	);
}

function AvatarFallback({
	className,
	...props
}: AvatarPrimitive.Fallback.Props) {
	return (
		<AvatarPrimitive.Fallback
			data-slot="avatar-fallback"
			className={cn(
				"flex size-full items-center justify-center rounded-full bg-field text-sm text-ink-3 group-data-[size=sm]/avatar:text-[10px]",
				className,
			)}
			{...props}
		/>
	);
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="avatar-group"
			className={cn(
				"group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-canvas",
				className,
			)}
			{...props}
		/>
	);
}

function AvatarGroupCount({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="avatar-group-count"
			className={cn(
				"relative flex size-8 shrink-0 items-center justify-center rounded-full bg-field text-sm text-ink-3 ring-2 ring-canvas group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
				className,
			)}
			{...props}
		/>
	);
}

export { Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount };
