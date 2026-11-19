import {
	type ChildLineageEvidence,
	getLaunchAnchorId,
	type LaunchAnchor,
	type LineageConfidence,
	SESSION_LINEAGE_DEFAULT_MATCH_WINDOW_MS,
	type SessionLineageCorrelationResult,
	type SessionLineageEdge,
} from "./types.js";

type CandidatePair = {
	anchor: LaunchAnchor;
	child: ChildLineageEvidence;
	confidence: Exclude<LineageConfidence, "ambiguous">;
};

export function correlateSessionLineage(
	anchors: readonly LaunchAnchor[],
	children: readonly ChildLineageEvidence[],
	matchWindowMs = SESSION_LINEAGE_DEFAULT_MATCH_WINDOW_MS,
): SessionLineageCorrelationResult {
	const eligibleAnchors = [...anchors].sort(compareAnchors);
	const eligibleChildren = [...children].sort(compareChildren);
	const pairs = buildCandidatePairs(
		eligibleAnchors,
		eligibleChildren,
		matchWindowMs,
	);
	const edges: SessionLineageEdge[] = [];
	const consumedAnchors = new Set<string>();
	const consumedChildren = new Set<string>();

	consumeExactIdPairs(pairs, consumedAnchors, consumedChildren, edges);
	consumePromptGroups(pairs, consumedAnchors, consumedChildren, edges);
	consumeUniqueTemporalPairs(pairs, consumedAnchors, consumedChildren, edges);

	return {
		edges: edges.sort((left, right) =>
			compareChildren(left.child, right.child),
		),
		unmatchedAnchorIds: eligibleAnchors
			.map(getLaunchAnchorId)
			.filter((id) => !consumedAnchors.has(id)),
		unmatchedChildIds: eligibleChildren
			.map(getChildEvidenceId)
			.filter((id) => !consumedChildren.has(id)),
	};
}

function buildCandidatePairs(
	anchors: readonly LaunchAnchor[],
	children: readonly ChildLineageEvidence[],
	matchWindowMs: number,
): readonly CandidatePair[] {
	return anchors.flatMap((anchor) =>
		children.flatMap((child): readonly CandidatePair[] => {
			if (
				!sharesScope(anchor, child) ||
				anchor.targetProvider !== child.provider
			) {
				return [];
			}
			if (anchor.echoedSessionIds.includes(child.childSessionId)) {
				if (child.provider === "claude" && anchor.prompt !== child.rootPrompt) {
					return [];
				}
				return [{ anchor, child, confidence: "id_echo" }];
			}
			if (anchor.prompt === child.rootPrompt) {
				return [{ anchor, child, confidence: "prompt_echo" }];
			}
			if (
				child.provider === "openai" &&
				isTemporalMatch(anchor, child, matchWindowMs)
			) {
				return [{ anchor, child, confidence: "attested_temporal" }];
			}
			return [];
		}),
	);
}

function consumeExactIdPairs(
	pairs: readonly CandidatePair[],
	consumedAnchors: Set<string>,
	consumedChildren: Set<string>,
	edges: SessionLineageEdge[],
): void {
	for (const pair of pairs.filter(
		(candidate) => candidate.confidence === "id_echo",
	)) {
		if (isConsumed(pair, consumedAnchors, consumedChildren)) continue;
		consume(
			pair,
			consumedAnchors,
			consumedChildren,
			edges,
			"exact child id echo",
		);
	}
}

function consumePromptGroups(
	pairs: readonly CandidatePair[],
	consumedAnchors: Set<string>,
	consumedChildren: Set<string>,
	edges: SessionLineageEdge[],
): void {
	const promptPairs = pairs.filter(
		(pair) =>
			pair.confidence === "prompt_echo" &&
			!isConsumed(pair, consumedAnchors, consumedChildren),
	);
	const groups = groupPromptPairs(promptPairs);
	for (const group of groups.values()) {
		const parentSessionIds = new Set(
			group.map((pair) => pair.anchor.parentSessionId),
		);
		if (parentSessionIds.size !== 1) continue;
		const anchors = uniqueAnchors(group).sort(compareAnchors);
		const children = uniqueChildren(group).sort(compareChildren);
		const pairCount = Math.min(anchors.length, children.length);
		for (let index = 0; index < pairCount; index += 1) {
			const anchor = anchors[index];
			const child = children[index];
			if (!anchor || !child) continue;
			const pair = { anchor, child, confidence: "prompt_echo" as const };
			if (isConsumed(pair, consumedAnchors, consumedChildren)) continue;
			consume(
				pair,
				consumedAnchors,
				consumedChildren,
				edges,
				"exact prompt echo",
			);
		}
	}
}

function groupPromptPairs(
	pairs: readonly CandidatePair[],
): ReadonlyMap<string, readonly CandidatePair[]> {
	const groups = new Map<string, CandidatePair[]>();
	for (const pair of pairs) {
		const key = [
			pair.anchor.organizationId,
			pair.anchor.userId,
			pair.anchor.targetProvider,
			pair.anchor.prompt,
		].join("\u0000");
		const group = groups.get(key) ?? [];
		group.push(pair);
		groups.set(key, group);
	}
	return groups;
}

function consumeUniqueTemporalPairs(
	pairs: readonly CandidatePair[],
	consumedAnchors: Set<string>,
	consumedChildren: Set<string>,
	edges: SessionLineageEdge[],
): void {
	const remaining = pairs.filter(
		(pair) =>
			pair.confidence === "attested_temporal" &&
			!isConsumed(pair, consumedAnchors, consumedChildren),
	);
	for (const pair of remaining.sort(comparePairDistance)) {
		const anchorMatches = remaining.filter(
			(candidate) =>
				getLaunchAnchorId(candidate.anchor) ===
					getLaunchAnchorId(pair.anchor) &&
				!consumedChildren.has(getChildEvidenceId(candidate.child)),
		);
		const childMatches = remaining.filter(
			(candidate) =>
				getChildEvidenceId(candidate.child) ===
					getChildEvidenceId(pair.child) &&
				!consumedAnchors.has(getLaunchAnchorId(candidate.anchor)),
		);
		if (anchorMatches.length !== 1 || childMatches.length !== 1) continue;
		consume(
			pair,
			consumedAnchors,
			consumedChildren,
			edges,
			"unique provider-attested temporal match",
		);
	}
}

function consume(
	pair: CandidatePair,
	consumedAnchors: Set<string>,
	consumedChildren: Set<string>,
	edges: SessionLineageEdge[],
	reason: string,
): void {
	consumedAnchors.add(getLaunchAnchorId(pair.anchor));
	consumedChildren.add(getChildEvidenceId(pair.child));
	edges.push({
		anchor: pair.anchor,
		child: pair.child,
		confidence: pair.confidence,
		countable: pair.child.outcome === "successful",
		reason,
	});
}

function isConsumed(
	pair: CandidatePair,
	consumedAnchors: ReadonlySet<string>,
	consumedChildren: ReadonlySet<string>,
): boolean {
	return (
		consumedAnchors.has(getLaunchAnchorId(pair.anchor)) ||
		consumedChildren.has(getChildEvidenceId(pair.child))
	);
}

function uniqueAnchors(pairs: readonly CandidatePair[]): LaunchAnchor[] {
	return [
		...new Map(
			pairs.map((pair) => [getLaunchAnchorId(pair.anchor), pair.anchor]),
		).values(),
	];
}

function uniqueChildren(
	pairs: readonly CandidatePair[],
): ChildLineageEvidence[] {
	return [
		...new Map(
			pairs.map((pair) => [getChildEvidenceId(pair.child), pair.child]),
		).values(),
	];
}

function getChildEvidenceId(child: ChildLineageEvidence): string {
	return `${child.childSource}:${child.childSessionId}`;
}

function sharesScope(
	anchor: LaunchAnchor,
	child: ChildLineageEvidence,
): boolean {
	return (
		anchor.organizationId === child.organizationId &&
		anchor.userId === child.userId &&
		(anchor.workdir === undefined ||
			child.workdir === undefined ||
			anchor.workdir === child.workdir)
	);
}

function isTemporalMatch(
	anchor: LaunchAnchor,
	child: ChildLineageEvidence,
	matchWindowMs: number,
): boolean {
	const anchorMs = Date.parse(anchor.anchorTs);
	const childMs = Date.parse(child.childStartTs);
	if (!Number.isFinite(anchorMs) || !Number.isFinite(childMs)) return false;
	const lag = childMs - anchorMs;
	return lag >= 0 && lag <= matchWindowMs;
}

function compareAnchors(left: LaunchAnchor, right: LaunchAnchor): number {
	return (
		left.anchorTs.localeCompare(right.anchorTs) ||
		getLaunchAnchorId(left).localeCompare(getLaunchAnchorId(right))
	);
}

function compareChildren(
	left: ChildLineageEvidence,
	right: ChildLineageEvidence,
): number {
	return (
		left.childFirstIngestedAt.localeCompare(right.childFirstIngestedAt) ||
		left.childStartTs.localeCompare(right.childStartTs) ||
		left.childSource.localeCompare(right.childSource) ||
		left.childSessionId.localeCompare(right.childSessionId)
	);
}

function comparePairDistance(
	left: CandidatePair,
	right: CandidatePair,
): number {
	return (
		getLag(left) - getLag(right) ||
		compareChildren(left.child, right.child) ||
		compareAnchors(left.anchor, right.anchor)
	);
}

function getLag(pair: CandidatePair): number {
	return Date.parse(pair.child.childStartTs) - Date.parse(pair.anchor.anchorTs);
}
