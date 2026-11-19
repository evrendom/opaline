import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSessionFileOf, useSessionPlaces } from "../session-places";

export function SessionFileLink({
	children,
	className,
	path,
}: {
	children: ReactNode;
	className?: string;
	path: string;
}) {
	const places = useSessionPlaces();
	const file = useSessionFileOf()(path);
	if (!places || !file) return <>{children}</>;
	return (
		<Link
			to={places.hrefs.file({ file })}
			title={`Open ${file} in Files`}
			onClick={(event) => event.stopPropagation()}
			className={cn("rounded-full outline-none hover:opacity-80", className)}
		>
			{children}
		</Link>
	);
}
