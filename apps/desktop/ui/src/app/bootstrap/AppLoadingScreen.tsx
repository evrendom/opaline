import { OpalineMark48 } from "./opaline-mark";
import "@/app/app-surface.css";

export function AppLoadingScreen({
	message = "Loading…",
}: {
	message?: string;
}) {
	return (
		<div
			aria-busy="true"
			aria-live="polite"
			className="dashboard-01-theme flex min-h-svh items-center justify-center bg-canvas text-ink"
		>
			<OpalineMark48 />
			<span className="sr-only">{message}</span>
		</div>
	);
}
