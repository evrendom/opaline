import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export function ShellHugeicon({
	icon,
	className,
	strokeWidth = 1.5,
}: {
	className?: string;
	icon: IconSvgElement;
	strokeWidth?: number;
}) {
	return (
		<HugeiconsIcon
			aria-hidden="true"
			className={className}
			color="currentColor"
			icon={icon}
			strokeWidth={strokeWidth}
		/>
	);
}
