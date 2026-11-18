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
			className="dashboard-01-theme flex min-h-svh items-center justify-center bg-(--dashboard-01-content-background) text-foreground"
		>
			<span
				aria-hidden="true"
				className="size-12 bg-[url(/favicon-light.svg)] bg-contain bg-center bg-no-repeat dark:bg-[url(/favicon-dark.svg)]"
			/>
			<span className="sr-only">{message}</span>
		</div>
	);
}
