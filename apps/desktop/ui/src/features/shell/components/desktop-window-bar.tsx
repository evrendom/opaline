import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

const buttonClassName =
	"flex size-7 items-center justify-center corner-s text-ink-3 transition-colors hover:bg-hover hover:text-ink";

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
			<button
				type="button"
				aria-label="Back"
				className={buttonClassName}
				onClick={() => navigate(-1)}
			>
				<IconChevronLeft className="size-4" stroke={1.75} />
			</button>
			<button
				type="button"
				aria-label="Forward"
				className={buttonClassName}
				onClick={() => navigate(1)}
			>
				<IconChevronRight className="size-4" stroke={1.75} />
			</button>
		</div>
	);
}
