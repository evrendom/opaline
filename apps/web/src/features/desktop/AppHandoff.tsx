import type { Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
	currentHandoffPage,
	desktopAppLink,
	serverHasDesktopApp,
} from "./app-handoff";

export function AppHandoff({ link }: { link: string }) {
	return (
		<main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
			<div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
				<span
					aria-hidden="true"
					className="size-12 bg-[url(/favicon-light.svg)] bg-contain bg-center bg-no-repeat dark:bg-[url(/favicon-dark.svg)]"
				/>
				<div className="flex flex-col gap-1.5">
					<h1 className="text-lg font-semibold">Opened in Opaline</h1>
					<p className="text-sm text-muted-foreground">
						This page is open in the Opaline app on this Mac. You can close this
						tab.
					</p>
				</div>
				<Button asChild>
					<a href={link}>Open Opaline</a>
				</Button>
			</div>
		</main>
	);
}

export async function handOffToDesktopApp(
	root: Root,
	proceed: () => void,
	hasDesktopApp: () => Promise<boolean> = serverHasDesktopApp,
	open: (link: string) => void = (link) => window.location.assign(link),
): Promise<boolean> {
	if (!(await hasDesktopApp())) {
		proceed();
		return false;
	}
	const link = desktopAppLink(currentHandoffPage());
	root.render(<AppHandoff link={link} />);
	document.documentElement.removeAttribute("data-boot");
	open(link);
	return true;
}
