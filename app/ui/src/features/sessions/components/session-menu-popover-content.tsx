import { Popover } from "@base-ui/react/popover";
import "./session-menu.css";

type SessionMenuPopoverContentProps = Popover.Popup.Props &
	Pick<Popover.Positioner.Props, "align" | "sideOffset">;

/** The session menus own their measured styling and motion. */
export function SessionMenuPopoverContent({
	align = "start",
	sideOffset = 6,
	...props
}: SessionMenuPopoverContentProps) {
	return (
		<Popover.Portal>
			<Popover.Positioner
				align={align}
				sideOffset={sideOffset}
				className="isolate z-50"
			>
				<Popover.Popup {...props} />
			</Popover.Positioner>
		</Popover.Portal>
	);
}
