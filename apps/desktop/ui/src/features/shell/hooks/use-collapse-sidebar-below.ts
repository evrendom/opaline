import { useLayoutEffect } from "react";
import { useLatestValueRef } from "@/app/hooks/useLatestValueRef";
import { useSidebar } from "@/app/ui/sidebar";

export function useCollapseSidebarBelow(widthPx: number) {
	const sidebarRef = useLatestValueRef(useSidebar());
	useLayoutEffect(() => {
		const narrow = window.matchMedia(`(max-width: ${widthPx - 1}px)`);
		let collapsedHere = false;
		const fit = () => {
			const { open, setOpen } = sidebarRef.current;
			if (narrow.matches && open) {
				collapsedHere = true;
				setOpen(false);
			} else if (!narrow.matches && collapsedHere) {
				collapsedHere = false;
				setOpen(true);
			}
		};
		fit();
		narrow.addEventListener("change", fit);
		return () => {
			narrow.removeEventListener("change", fit);
			if (collapsedHere) sidebarRef.current.setOpen(true);
		};
	}, [widthPx, sidebarRef]);
}
