import { useContext } from "react";
import type { ContextPart } from "./session-reader-context-map";
import {
	type PickedMaps,
	PickedPartSink,
	type PickedRuns,
	pickedPart,
} from "./session-reader-context-pick";
import { thingName } from "./session-reader-context-zoom";

/** Hands the box picked in the map to the page outside it that follows the
 * pick, when there is one (the repo page's rail). */
export function FollowPicked({
	maps,
	memory,
	onClear,
	part,
	runs,
	thing,
}: {
	maps: PickedMaps;
	memory: string | undefined;
	onClear: () => void;
	part: ContextPart | null;
	runs: PickedRuns;
	thing: string | null;
}) {
	const Sink = useContext(PickedPartSink);
	if (!Sink) return null;
	return (
		<Sink
			part={pickedPart(
				part,
				maps,
				runs,
				thing,
				part && thing ? thingName(part, thing) : null,
				memory,
				onClear,
			)}
		/>
	);
}
