import type { SessionSetupFile } from "@rudel/api-routes";
import { cn } from "@/lib/utils";
import { useSessionPlaces } from "../session-places";
import { SetupMark } from "../setup/session-reader-setup-column";
import { setupName, setupOwner } from "../setup/session-setup-files";
import {
	Empty,
	Meta,
	type OpenPlace,
	Pending,
	ShortList,
	SkillRow,
	SUMMARY_TOP_HEIGHT,
} from "./session-reader-summary-sections";
import { groupSetupFiles, type SummarySkill } from "./session-summary-model";

export function SummarySkillsAndFiles({
	empty = "No skills or context files.",
	onOpen,
	onOpenSetup,
	setup,
	skills,
}: {
	empty?: string;
	onOpen: OpenPlace;
	onOpenSetup: (setupFile: string) => void;
	setup: readonly SessionSetupFile[] | undefined;
	skills: readonly SummarySkill[];
}) {
	const places = useSessionPlaces();
	const files = setup ? groupSetupFiles(setup).instructions : [];
	const rows: (
		| { file: SessionSetupFile; skill?: never }
		| { file?: never; skill: SummarySkill }
	)[] = [
		...skills.map((skill) => ({ skill })),
		...files.map((file) => ({ file })),
	];
	if (rows.length === 0) return setup ? <Empty>{empty}</Empty> : <Pending />;
	return (
		<ShortList
			items={rows}
			maxHeight={SUMMARY_TOP_HEIGHT}
			onShowAll={places ? () => places.openSetup() : undefined}
			render={(row) =>
				row.skill ? (
					<SkillRow
						key={`skill:${row.skill.name}`}
						onOpen={onOpen}
						skill={row.skill}
					/>
				) : (
					<SetupRow
						key={row.file.setupFile}
						file={row.file}
						onOpen={onOpenSetup}
					/>
				)
			}
		/>
	);
}

export function SummaryMcpAndTools({
	empty = "No MCP servers or harness text recorded.",
	onOpen,
	setup,
}: {
	empty?: string;
	onOpen: (setupFile: string) => void;
	setup: readonly SessionSetupFile[] | undefined;
}) {
	const places = useSessionPlaces();
	if (!setup) return <Pending />;
	const { harness, mcp } = groupSetupFiles(setup);
	const files = [...mcp, ...harness];
	if (files.length === 0) return <Empty>{empty}</Empty>;
	return (
		<ShortList
			items={files}
			onShowAll={places ? () => places.openSetup() : undefined}
			render={(file) => (
				<SetupRow key={file.setupFile} file={file} onOpen={onOpen} />
			)}
		/>
	);
}

function SetupRow({
	file,
	onOpen,
}: {
	file: SessionSetupFile;
	onOpen: (setupFile: string) => void;
}) {
	return (
		<li className="flex min-w-0">
			<button
				type="button"
				title={`Read ${setupName(file)} in Setup`}
				onClick={() => onOpen(file.setupFile)}
				className={cn(
					"flex min-h-8 min-w-0 flex-1 items-center gap-[calc(var(--space-m)+var(--space-xxs))]",
					"corner-s px-m py-xs",
					// design-escape-ok(type): shipped value; 13px on the card's 14/20 ratio (18.57)
					"text-left text-[13px]/[calc(20/14)]",
					"outline-none",
					// design-escape-ok(opacity): shipped value; field/60
					"hover:bg-field/60",
				)}
			>
				<SetupMark file={file} />
				<span className="min-w-0 flex-1 truncate">{setupName(file)}</span>
				<Meta>
					{setupOwner(file)}
					{file.kind === "nested_memory" ? " · on entering" : ""}
				</Meta>
				<Meta>
					{file.versions > 1 ? `${file.versions} versions · ` : ""}
					{file.runs} {file.runs === 1 ? "run" : "runs"}
				</Meta>
			</button>
		</li>
	);
}
