import type { MomentKind, SessionDetailTurnSummary } from "@rudel/api-routes";
import { useMemo } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { signalMarkClassName } from "@/components/signal-text";
import { MOMENT_KINDS_APPEARANCE } from "@/features/compass/moment-labels";
import { FlagChip, useTurnFlags } from "@/features/compass/session-flags";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionReaderBodies } from "../detail/use-session-reader-bodies";
import {
	formatReaderCost,
	getReaderAgentMessages,
	getReaderMemberText,
} from "../model/session-reader-model";
import { errorImpact, runErrors } from "./session-reader-run-errors";
import {
	apologySnippets,
	frustratedSnippets,
	frustratedWords,
	type Snippet,
} from "./session-reader-said";
import { ErrorTypeRows, errorTypes } from "./session-reader-summary-errors";
import { ErrorChip, Row } from "./session-reader-summary-row";
import { Empty, Pending } from "./session-reader-summary-sections";

export type FlagGroup = "context" | "cost" | "time" | "turns";

export function flagGroup(kind: MomentKind): FlagGroup {
	if (kind === "expensive_run") return "cost";
	if (kind === "long_run") return "time";
	if (kind === "compaction") return "context";
	return "turns";
}

const SNIPPETS = 3;

const NOOP = () => {};

function ownCost(reason: string, total: number | null | undefined) {
	const match = /^\$([\d,]+(?:\.\d+)?)/u.exec(reason);
	const own = match?.[1] ? Number(match[1].replaceAll(",", "")) : null;
	if (
		own === null ||
		total === null ||
		total === undefined ||
		total - own < 0.01
	)
		return reason;
	return reason.replace(
		/^\$[\d,]+(?:\.\d+)?/u,
		`${match?.[0]} by the main agent (${formatReaderCost(total)} with its subagents)`,
	);
}

export const soundsFrustrated = (turn: SessionDetailTurnSummary | undefined) =>
	turn !== undefined &&
	(turn.signalOccurrences.some((signal) => signal.category === "negative") ||
		frustratedWords(turn.userPreview ?? "").length > 0);

export function frustrationReason(detail: string, side: "after" | "before") {
	if (side === "after") return detail;
	return detail
		.replace("frustrated next prompt", "frustrated prompt")
		.replace("The next prompt", "Its prompt");
}

export function SnippetText({
	category,
	snippet,
}: {
	category: "apology" | "negative";
	snippet: Snippet;
}) {
	return (
		<>
			{snippet.cutStart ? "…" : null}
			{snippet.parts.map((part, at) =>
				part.match ? (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: the snippet's own pieces, in place
						key={at}
						data-signal={category}
						className={signalMarkClassName(category)}
					>
						{part.text}
					</span>
				) : (
					part.text
				),
			)}
			{snippet.cutEnd ? "…" : null}
		</>
	);
}

function SnippetLines({
	category,
	snippets,
}: {
	category: "apology" | "negative";
	snippets: readonly Snippet[];
}) {
	return (
		<span className="flex min-w-0 flex-col gap-xs edge-l-l border-line pl-l">
			{snippets.slice(0, SNIPPETS).map((snippet, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: a snippet's place is its key
					key={index}
					className="text-body-l [overflow-wrap:anywhere] text-ink-3"
				>
					<SnippetText category={category} snippet={snippet} />
				</span>
			))}
			{snippets.length > SNIPPETS ? (
				// design-escape-ok(opacity): shipped value; muted-foreground/70
				<span className="text-body-m text-ink-3/70 tabular-nums">
					+{snippets.length - SNIPPETS} more
				</span>
			) : null}
		</span>
	);
}

function PromptSnippets({
	failed,
	preview,
	text,
}: {
	failed: boolean;
	preview: string | null;
	text: string | null;
}) {
	const said = text ?? preview;
	if (!said)
		return failed ? (
			<Empty>Its transcript couldn't be read.</Empty>
		) : (
			<Pending />
		);
	return (
		<SnippetLines category="negative" snippets={frustratedSnippets(said)} />
	);
}

export function SummaryFlags({
	agent,
	group,
	overview,
	turn,
	turns,
}: {
	agent: string | null;
	group: FlagGroup;
	overview: NormalizedSessionDetailOverview;
	turn: SessionDetailTurnSummary;
	turns: readonly SessionDetailTurnSummary[];
}) {
	const at = turns.indexOf(turn);
	const previous = at > 0 ? turns[at - 1] : undefined;
	const next = at >= 0 ? turns[at + 1] : undefined;
	const scope = useMemo(
		() => (previous ? [previous, turn] : [turn]),
		[previous, turn],
	);
	const { flags } = useTurnFlags(
		{
			from: overview.session.sessionDate,
			sessionId: overview.session.sessionId,
			to: overview.session.lastInteractionDate,
			totalTurns: overview.turnPage.total,
			turns,
		},
		scope,
		agent,
	);
	const { getBody, requestBody } = useSessionReaderBodies({
		initialWindow: undefined,
		onStaleRevision: NOOP,
		revision: overview.revision,
		sessionId: overview.session.sessionId,
	});
	const turnsGroup = group === "turns";
	useMountEffect(() => {
		if (!turnsGroup) return;
		requestBody(turn.turnId);
		if (next) requestBody(next.turnId);
	});
	const read = getBody(turn.turnId);
	const after = next ? getBody(next.turnId) : null;
	const ownBody = read.status === "ready" ? read.body : null;
	const apologies = useMemo(
		() => (ownBody ? apologySnippets(getReaderAgentMessages(ownBody)) : []),
		[ownBody],
	);
	const reasonsOn = (kind: MomentKind, turnId: string | undefined) =>
		(flags.find((flag) => flag.kind === kind)?.reasons ?? [])
			.filter((reason) => reason.turnId === turnId)
			.map((reason) => reason.detail);
	const frustratedBefore = reasonsOn("user_frustrated", previous?.turnId);
	const frustratedAfter = reasonsOn("user_frustrated", turn.turnId);
	const apologyReasons = reasonsOn("model_apology", turn.turnId);
	const failures = turnsGroup && ownBody ? runErrors(ownBody) : null;
	const impact = useMemo(
		() => (turnsGroup && ownBody ? errorImpact(ownBody) : null),
		[ownBody, turnsGroup],
	);
	const types =
		impact && failures ? errorTypes(impact, failures.stuck, turn.turnId) : [];
	const pending = turnsGroup && !failures ? turn.errorCount : 0;
	const flagged = flags.flatMap(({ kind }) => {
		const reasons = reasonsOn(kind, turn.turnId);
		return kind === "user_frustrated" ||
			kind === "model_apology" ||
			kind === "failing_streak" ||
			flagGroup(kind) !== group ||
			reasons.length === 0
			? []
			: [{ kind, reasons }];
	});
	const promptBefore = ownBody ? getReaderMemberText(ownBody) : null;
	const promptAfter =
		after?.status === "ready" ? getReaderMemberText(after.body) : null;
	const before =
		turnsGroup &&
		(frustratedBefore.length > 0 ||
			soundsFrustrated(turn) ||
			(promptBefore !== null && frustratedWords(promptBefore).length > 0));
	const afterIt =
		turnsGroup &&
		next &&
		(frustratedAfter.length > 0 ||
			soundsFrustrated(next) ||
			(promptAfter !== null && frustratedWords(promptAfter).length > 0));
	const apologized =
		turnsGroup &&
		(apologyReasons.length > 0 ||
			(turn.modelApologyCount ?? 0) > 0 ||
			apologies.length > 0);
	if (
		flagged.length === 0 &&
		types.length === 0 &&
		!failures?.stuck.length &&
		pending === 0 &&
		!before &&
		!afterIt &&
		!apologized
	)
		return null;
	return (
		// design-escape-ok(opacity): shipped value; border/60
		<ul className="flex flex-col divide-y divide-line/60">
			{before ? (
				<Row
					chip={<FlagChip kind="user_frustrated" />}
					label="Frustrated before it"
					reasons={frustratedBefore.map((detail) =>
						frustrationReason(detail, "before"),
					)}
				>
					<PromptSnippets
						failed={read.status === "failed"}
						preview={turn.userPreview}
						text={promptBefore}
					/>
				</Row>
			) : null}
			{flagged.map(({ kind, reasons }) => (
				<Row
					key={kind}
					chip={<FlagChip kind={kind} />}
					label={MOMENT_KINDS_APPEARANCE[kind].label}
					reasons={
						kind === "expensive_run"
							? reasons.map((reason) => ownCost(reason, turn.estimatedCost))
							: reasons
					}
				/>
			))}
			{types.length > 0 ? (
				<ErrorTypeRows types={types} />
			) : pending > 0 ? (
				<Row chip={<ErrorChip />} label="Errors" reasons={[`${pending}`]} />
			) : null}
			{apologized ? (
				<Row
					chip={<FlagChip kind="model_apology" />}
					label={MOMENT_KINDS_APPEARANCE.model_apology.label}
					reasons={apologyReasons}
				>
					{read.status === "failed" ? (
						<Empty>Its transcript couldn't be read.</Empty>
					) : !ownBody ? (
						<Pending />
					) : apologies.length === 0 ? (
						<Empty>No apology in its messages.</Empty>
					) : (
						<SnippetLines category="apology" snippets={apologies} />
					)}
				</Row>
			) : null}
			{afterIt && next ? (
				<Row
					chip={<FlagChip kind="user_frustrated" />}
					label="Frustrated after it"
					reasons={frustratedAfter.map((detail) =>
						frustrationReason(detail, "after"),
					)}
				>
					<PromptSnippets
						failed={after?.status === "failed"}
						preview={next.userPreview}
						text={promptAfter}
					/>
				</Row>
			) : null}
		</ul>
	);
}
