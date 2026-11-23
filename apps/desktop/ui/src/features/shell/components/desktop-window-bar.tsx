import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/app/ui/button";

export function DesktopWindowBar() {
	const navigate = useNavigate();

	return (
		<div className="desktop-window-bar">
			{import.meta.env.MODE === "product-demo" ? (
				<span className="desktop-window-lights" aria-hidden="true">
					<span />
					<span />
					<span />
				</span>
			) : null}
			<Button
				type="button"
				size="icon-sm"
				aria-label="Back"
				onClick={() => navigate(-1)}
			>
				<IconChevronLeft className="size-4 text-ink-chrome" stroke={1.75} />
			</Button>
			<Button
				type="button"
				size="icon-sm"
				aria-label="Forward"
				onClick={() => navigate(1)}
			>
				<IconChevronRight className="size-4 text-ink-chrome" stroke={1.75} />
			</Button>
		</div>
	);
}
