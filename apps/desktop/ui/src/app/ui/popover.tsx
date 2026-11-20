import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";

import { cn } from "@/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
	children,
	className,
	align = "center",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 4,
	...props
}: PopoverPrimitive.Popup.Props &
	Pick<
		PopoverPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset"
	>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
				className="isolate z-50"
			>
				<PopoverPrimitive.Popup
					data-fluid-menu-root=""
					data-slot="popover-content"
					className={cn(
						"z-50 flex w-72 flex-col gap-xl",
						"corner-m corner-squircle p-l",
						"text-body-xl",
						"origin-(--transform-origin) bg-surface text-ink shadow-(--shadow-card) outline-hidden duration-100",
						"squircle:corner-xl",
						"data-[side=bottom]:slide-in-from-top-2",
						"data-[side=inline-end]:slide-in-from-left-2",
						"data-[side=inline-start]:slide-in-from-right-2",
						"data-[side=left]:slide-in-from-right-2",
						"data-[side=right]:slide-in-from-left-2",
						"data-[side=top]:slide-in-from-bottom-2",
						"data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
						"data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				>
					<FluidMenuHover />
					{children}
				</PopoverPrimitive.Popup>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
	return (
		<PopoverPrimitive.Title
			data-slot="popover-title"
			className={cn("font-medium", className)}
			{...props}
		/>
	);
}

export { Popover, PopoverContent, PopoverTitle, PopoverTrigger };
