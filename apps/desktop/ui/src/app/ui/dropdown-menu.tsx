import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { IconCheck } from "@tabler/icons-react";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import { cn } from "@/lib/utils";

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
	return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
	return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
	children,
	align = "start",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 4,
	className,
	...props
}: MenuPrimitive.Popup.Props &
	Pick<
		MenuPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset"
	>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				className="isolate z-50 outline-none"
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
			>
				<MenuPrimitive.Popup
					data-fluid-menu-root=""
					data-slot="dropdown-menu-content"
					className={cn(
						"z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 overflow-x-hidden overflow-y-auto",
						"corner-s corner-squircle p-xs",
						"origin-(--transform-origin) bg-surface text-ink shadow-card duration-(--motion-quick-duration) outline-none",
						"squircle:corner-xl-inner",
						"data-[side=bottom]:slide-in-from-top-2",
						"data-[side=inline-end]:slide-in-from-left-2",
						"data-[side=inline-start]:slide-in-from-right-2",
						"data-[side=left]:slide-in-from-right-2",
						"data-[side=right]:slide-in-from-left-2",
						"data-[side=top]:slide-in-from-bottom-2",
						"data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
						"data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				>
					<FluidMenuHover />
					{children}
				</MenuPrimitive.Popup>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

function DropdownMenuItem({
	className,
	inset,
	variant = "default",
	...props
}: MenuPrimitive.Item.Props & {
	inset?: boolean;
	variant?: "default" | "danger";
}) {
	return (
		<MenuPrimitive.Item
			data-slot="dropdown-menu-item"
			data-inset={inset}
			data-variant={variant}
			className={cn(
				"group/dropdown-menu-item relative flex items-center gap-m",
				"corner-xs px-m py-s",
				"text-body-xl",
				"outline-hidden select-none",
				"focus:bg-hover focus:text-sidebar-accent-foreground",
				"not-data-[variant=danger]:focus:**:text-sidebar-accent-foreground",
				"data-inset:pl-xxxl",
				"data-[variant=danger]:text-error data-[variant=danger]:focus:bg-error-tint data-[variant=danger]:focus:text-error",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				"[&_svg:not([class*='size-'])]:size-4",
				"data-[variant=danger]:*:[svg]:text-error",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	inset,
	...props
}: MenuPrimitive.CheckboxItem.Props & {
	inset?: boolean;
}) {
	return (
		<MenuPrimitive.CheckboxItem
			data-slot="dropdown-menu-checkbox-item"
			data-inset={inset}
			className={cn(
				"relative flex items-center gap-m",
				"corner-xs py-s pr-xxxl pl-m",
				"text-body-xl",
				"outline-hidden select-none",
				"focus:bg-hover focus:text-sidebar-accent-foreground focus:**:text-sidebar-accent-foreground",
				"data-inset:pl-xxxl",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				"[&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			checked={checked}
			{...props}
		>
			<span
				className="pointer-events-none absolute right-2 flex items-center justify-center"
				data-slot="dropdown-menu-checkbox-item-indicator"
			>
				<MenuPrimitive.CheckboxItemIndicator>
					<IconCheck />
				</MenuPrimitive.CheckboxItemIndicator>
			</span>
			{children}
		</MenuPrimitive.CheckboxItem>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: MenuPrimitive.Separator.Props) {
	return (
		<MenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn("-mx-xs my-xs h-px bg-line", className)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuSeparator,
};
