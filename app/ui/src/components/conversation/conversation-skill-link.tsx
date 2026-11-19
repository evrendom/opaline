import { createContext, type ReactNode, useContext } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export const ConversationSkillLinkContext = createContext<
	((name: string, turnId?: string) => string) | undefined
>(undefined);

export const ConversationSkillTurnContext = createContext<string | undefined>(
	undefined,
);

export function ConversationSkillLink({
	children,
	className,
	href,
	name,
}: {
	children: ReactNode;
	className?: string;
	href?: string;
	name: string;
}) {
	const getSkillHref = useContext(ConversationSkillLinkContext);
	const turnId = useContext(ConversationSkillTurnContext);
	const destination = href ?? getSkillHref?.(name, turnId);
	if (!destination) return <span className={className}>{children}</span>;
	return (
		<Link
			aria-label={`Open skill ${name}`}
			className={cn(
				"inline-flex min-w-0 rounded-[5px] outline-none",
				className,
			)}
			onClick={(event) => event.stopPropagation()}
			to={destination}
		>
			{children}
		</Link>
	);
}
