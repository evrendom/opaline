import {
	IconBoltFilled,
	IconMessages,
	IconPlug,
	IconTool,
	IconZoomCancel,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Reveal } from "@/app/ui/bones";
import { Button } from "@/app/ui/button";
import { SearchInput } from "@/components/dashboard/data-table";
import { PageEmptyState } from "@/components/dashboard/page-parts";
import { RetryButton } from "@/components/retry-button";
import {
	type McpServer,
	mcpServers,
} from "@/features/repos/repo-reader/repo-mcp-servers";
import {
	useRepoMcpTools,
	useRepoSetup,
} from "@/features/repos/repo-reader/use-repo-setup";
import { ToolbarSortMenu } from "@/features/sessions/components/sessions-overview-sort-menu";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { ScrollColumn } from "@/features/sessions/reader/files/session-reader-files-parts";
import {
	OverviewCard,
	StripPill,
} from "@/features/skills/components/skill-cards";
import { cn } from "@/lib/utils";

type McpSortKey = "calls" | "sessions" | "tools" | "name";
type McpSort = { key: McpSortKey; direction: "asc" | "desc" };

const MCP_SORT_OPTIONS = [
	{ key: "calls", label: "Calls" },
	{ key: "sessions", label: "Sessions" },
	{ key: "tools", label: "Tools" },
	{ key: "name", label: "Name" },
] as const satisfies readonly { key: McpSortKey; label: string }[];

const SHOWN_TOOLS = 6;

export function McpPageView({
	onSelect,
}: {
	onSelect: (name: string) => void;
}) {
	const setup = useRepoSetup(undefined, { allTime: true });
	const tools = useRepoMcpTools(undefined, true, { allTime: true });
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<McpSort>({
		key: "calls",
		direction: "desc",
	});
	const servers = useMemo(
		() =>
			setup.data && tools.data
				? mcpServers(setup.data.files, tools.data.tools)
				: undefined,
		[setup.data, tools.data],
	);
	const visible = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return (servers ?? [])
			.filter(
				(server) => !query || server.name.toLocaleLowerCase().includes(query),
			)
			.sort((left, right) => {
				const order = compareServers(left, right, sort.key);
				return sort.direction === "asc" ? order : -order;
			});
	}, [servers, search, sort]);
	const isPending = setup.isPending || tools.isPending;
	const isError = setup.isError || tools.isError;

	return (
		<div
			className={cn(
				"dashboardy-page isolate antialiased",
				SESSION_OVERVIEW_SURFACE_CLASS_NAME,
			)}
		>
			<section
				aria-label="MCP servers"
				className="flex min-h-0 min-w-0 flex-1 flex-col"
			>
				<div className="flex h-12 shrink-0 items-center gap-m px-xxl">
					<SearchInput
						value={search}
						onChange={setSearch}
						placeholder="Search MCP servers…"
						label="Search MCP servers"
					/>
					<ToolbarSortMenu
						activeSortLabel={
							MCP_SORT_OPTIONS.find((option) => option.key === sort.key)
								?.label ?? "Calls"
						}
						getInitialDirection={(key) => (key === "name" ? "asc" : "desc")}
						noun="MCP servers"
						onSortChange={setSort}
						options={MCP_SORT_OPTIONS}
						sort={sort}
					/>
				</div>
				{!isPending && isError ? (
					<PageEmptyState
						icon={IconPlug}
						title="MCP servers couldn’t be loaded"
						description="Your sessions are still available. Try loading this view again."
						action={
							<RetryButton
								onRetry={() => {
									void setup.refetch();
									void tools.refetch();
								}}
							/>
						}
					/>
				) : !isPending && (servers?.length ?? 0) === 0 ? (
					<PageEmptyState
						icon={IconPlug}
						title="No MCP servers yet"
						description="MCP servers appear here once a session connects one or calls its tools."
					/>
				) : !isPending && visible.length === 0 ? (
					<PageEmptyState
						icon={IconZoomCancel}
						title="No matching MCP servers"
						description="Try a different name or clear the search."
						action={
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => setSearch("")}
							>
								Clear search
							</Button>
						}
					/>
				) : (
					<Reveal
						fill
						className="min-h-0 min-w-0 flex-1"
						label="Loading MCP servers"
						loading={isPending}
						sample={<McpCardsGrid servers={SAMPLE_SERVERS} onSelect={NOOP} />}
						sampleId="mcp"
					>
						{() => <McpCardsGrid servers={visible} onSelect={onSelect} />}
					</Reveal>
				)}
			</section>
		</div>
	);
}

function McpCardsGrid({
	servers,
	onSelect,
}: {
	servers: readonly McpServer[];
	onSelect: (name: string) => void;
}) {
	return (
		<ScrollColumn className="min-w-0 overscroll-contain">
			<ul
				aria-label="MCP servers"
				className="grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-xxl p-xl sm:p-xxl lg:p-xxl"
			>
				{servers.map((server) => (
					<li key={server.file.setupFile} className="min-w-0">
						<McpCard server={server} onSelect={onSelect} />
					</li>
				))}
			</ul>
		</ScrollColumn>
	);
}

function McpCard({
	server,
	onSelect,
}: {
	server: McpServer;
	onSelect: (name: string) => void;
}) {
	return (
		<OverviewCard
			name={server.name}
			onSelect={onSelect}
			pills={
				<>
					<StripPill
						icon={IconBoltFilled}
						label={`${server.calls.toLocaleString()} ${server.calls === 1 ? "call" : "calls"}`}
					/>
					{server.tools.length > 0 ? (
						<StripPill
							icon={IconTool}
							label={server.tools.length.toLocaleString()}
							title={`${server.tools.length} ${server.tools.length === 1 ? "tool" : "tools"} called`}
						/>
					) : null}
					{server.sessions > 0 ? (
						<StripPill
							icon={IconMessages}
							label={server.sessions.toLocaleString()}
							title={`${server.sessions} ${server.sessions === 1 ? "session" : "sessions"}`}
						/>
					) : null}
				</>
			}
		>
			{server.tools.length > 0 ? (
				<ul className="flex w-full min-w-0 flex-col gap-xs pt-s text-body-l">
					{server.tools.slice(0, SHOWN_TOOLS).map((tool) => (
						<li
							key={tool.name}
							data-card-row=""
							className="flex min-w-0 items-baseline gap-m"
						>
							<span className="min-w-0 truncate text-ink/75">{tool.name}</span>
							<span className="ml-auto shrink-0 text-body-m text-ink-3 tabular-nums">
								{tool.calls.toLocaleString()}
							</span>
						</li>
					))}
				</ul>
			) : (
				<p className="pt-s text-body-m text-ink-3">
					Connected in {server.sessions.toLocaleString()}{" "}
					{server.sessions === 1 ? "session" : "sessions"}, never called.
				</p>
			)}
		</OverviewCard>
	);
}

function compareServers(left: McpServer, right: McpServer, key: McpSortKey) {
	if (key === "name")
		return left.name.localeCompare(right.name, undefined, {
			numeric: true,
			sensitivity: "base",
		});
	if (key === "tools") return left.tools.length - right.tools.length;
	return left[key] - right[key];
}

const NOOP = () => {};
const SAMPLE_SERVERS: McpServer[] = [
	["linear", 48, 12, 6],
	["github", 36, 9, 5],
	["posthog", 22, 7, 4],
	["context7", 18, 6, 2],
	["sentry", 12, 4, 3],
	["slack", 8, 3, 2],
	["notion", 6, 2, 2],
	["figma", 4, 2, 1],
].map(([name, calls, sessions, count]) => ({
	calls: calls as number,
	connected: true,
	file: {
		chars: 0,
		firstAt: "",
		kind: "mcp_instructions",
		lastAt: "",
		owner: name as string,
		path: "",
		runs: 0,
		scope: "mcp",
		sessions: sessions as number,
		setupFile: `mcp:${name}`,
		subagents: false,
		versions: 1,
	},
	name: name as string,
	sessions: sessions as number,
	tools: Array.from({ length: count as number }, (_, at) => ({
		name: `tool_${at + 1}`,
		calls: Math.max(1, Math.round((calls as number) / (at + 2))),
	})),
}));
