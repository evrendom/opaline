import { Menu } from "@base-ui/react/menu";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { cn } from "@/lib/utils";
import "./session-menu.css";

type SessionMenuPopupProps = Omit<Menu.Popup.Props, "className"> &
	Pick<Menu.Positioner.Props, "align"> & {
		className?: string;
		fluidHover?: boolean;
	};

export function SessionMenuPopup({
	align = "start",
	children,
	className,
	fluidHover = true,
	...props
}: SessionMenuPopupProps) {
	return (
		<Menu.Portal>
			<Menu.Positioner align={align} sideOffset={6} className="z-50">
				<Menu.Popup
					data-fluid-menu-root={fluidHover ? "" : undefined}
					className={cn("session-menu-surface session-menu-sort", className)}
					{...props}
				>
					{fluidHover ? <FluidMenuHover /> : null}
					{children}
				</Menu.Popup>
			</Menu.Positioner>
		</Menu.Portal>
	);
}
