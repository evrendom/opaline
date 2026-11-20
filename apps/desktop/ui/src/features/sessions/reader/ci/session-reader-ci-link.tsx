import type { RunCiRun } from "@rudel/api-routes";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSessionPlaces } from "../session-places";
import { pullKeysOf } from "./session-reader-ci-model";

export function ciRunPicks(run: RunCiRun): { ci: string; pr?: string } {
	const pr = pullKeysOf(run)[0];
	return pr ? { ci: run.ciRunId, pr } : { ci: run.ciRunId };
}

const own = (event: MouseEvent) => event.stopPropagation();

export function CiViewLink({
	children,
	className,
	github,
	picks,
	title,
}: {
	children: ReactNode;
	className?: string;
	github: string | null;
	picks: { ci?: string; pr?: string };
	title?: string;
}) {
	const places = useSessionPlaces();
	if (places)
		return (
			<Link
				to={places.hrefs.ci(picks)}
				title={title ?? "Open in CI & PRs"}
				onClick={own}
				className={className}
			>
				{children}
			</Link>
		);
	if (!github) return <span className={className}>{children}</span>;
	return (
		<a
			href={github}
			target="_blank"
			rel="noreferrer"
			onClick={own}
			className={className}
		>
			{children}
		</a>
	);
}

export function GitHubLink({
	className,
	href,
	label,
}: {
	className?: string;
	href: string;
	label: string;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			aria-label={label}
			title={label}
			onClick={own}
			className={cn(
				"shrink-0 corner-xs p-xxs text-ink-3 hover:bg-hover hover:text-ink",
				className,
			)}
		>
			<IconArrowUpRight aria-hidden="true" className="size-3.5" />
		</a>
	);
}
