import { IconBook, IconPlug } from "@tabler/icons-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { OpalineShape } from "@/features/shell/components/shell-nav-icon";
import { mcpTone, skillsTone } from "@/features/shell/config/shell-routes";
import { cn } from "@/lib/utils";
import {
	mcpServerLabel,
	USE_PARAM,
	type UseHint,
	writeUseHint,
} from "../reader/detail/reader-use-hint";
import { SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME } from "./session-overview-row-elements";

export type SessionMcpServerUse = { server: string; at: number };

const KINDS = {
	skill: { icon: IconBook, label: "Skills", tone: skillsTone },
	mcp: { icon: IconPlug, label: "MCP servers", tone: mcpTone },
} as const;

function hrefOf(sessionHref: string | undefined, hint: UseHint) {
	if (!sessionHref) return undefined;
	const [path, query = ""] = sessionHref.split("?");
	const params = new URLSearchParams(query);
	params.set("sessionTab", "detail");
	params.set(USE_PARAM, writeUseHint(hint));
	return `${path}?${params}`;
}

type ToolTagProps = {
	kind: keyof typeof KINDS;
	names: readonly string[];
	href: string | undefined;
};

function LinkedToolTag(props: ToolTagProps & { href: string }) {
	const navigate = useNavigate();
	return (
		<ToolTag
			{...props}
			onOpen={(event) => {
				event.preventDefault();
				event.stopPropagation();
				navigate(props.href);
			}}
		/>
	);
}

function ToolTag({
	kind,
	names,
	onOpen,
}: ToolTagProps & { onOpen?: (event: MouseEvent | KeyboardEvent) => void }) {
	const [first, ...rest] = names;
	if (!first) return null;
	const { icon: Icon, label, tone } = KINDS[kind];
	return (
		<span
			className={cn(
				SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
				"h-[1.1875rem] max-w-44 gap-xs [corner-shape:superellipse(1.25)]",
				"corner-m py-xxs pr-s pl-xxs",
				"text-ink bg-card shadow-(--shadow-card)",
				"dark:bg-ink-3/10",
				onOpen && "cursor-pointer hover:bg-hover",
			)}
			data-session-overview-tool-tag={kind}
			{...(onOpen
				? {
						role: "link",
						tabIndex: 0,
						onClick: onOpen,
						onKeyDown: (event: KeyboardEvent) => {
							if (event.key === "Enter") onOpen(event);
						},
					}
				: {})}
		>
			<span className="relative grid size-3.5 shrink-0 place-items-center">
				<OpalineShape className={cn("absolute inset-0", tone.chip)} />
				<Icon
					aria-hidden="true"
					className={cn("relative size-2.5", tone.glyph)}
				/>
			</span>
			<span className="min-w-0 truncate" aria-hidden="true">
				{first}
			</span>
			{rest.length > 0 ? (
				<span className="shrink-0 text-body-xxs text-ink-3" aria-hidden="true">
					+{rest.length}
				</span>
			) : null}
			<span className="sr-only">
				{label}: {names.join(", ")}
			</span>
		</span>
	);
}

function Tag(props: ToolTagProps & { linked: boolean }) {
	const { linked, ...tag } = props;
	if (props.names.length === 0) return null;
	return linked && tag.href ? (
		<LinkedToolTag {...tag} href={tag.href} />
	) : (
		<ToolTag {...tag} />
	);
}

export function SessionOverviewToolTags({
	skills,
	mcpServers,
	sessionHref,
}: {
	skills: readonly string[];
	mcpServers: readonly SessionMcpServerUse[] | undefined;
	sessionHref?: string;
}) {
	const linked = useInRouterContext();
	const firstServer = mcpServers?.[0];
	return (
		<>
			<Tag
				linked={linked}
				kind="skill"
				names={skills}
				href={
					skills[0]
						? hrefOf(sessionHref, { kind: "skill", name: skills[0] })
						: undefined
				}
			/>
			<Tag
				linked={linked}
				kind="mcp"
				names={(mcpServers ?? []).map((use) => mcpServerLabel(use.server))}
				href={
					firstServer
						? hrefOf(sessionHref, {
								kind: "mcp",
								name: firstServer.server,
								at: firstServer.at,
							})
						: undefined
				}
			/>
		</>
	);
}
