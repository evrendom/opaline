import type { SessionDetailWindowTurn } from "../schemas/session-detail-payload.js";

export type SessionReaderBody = NonNullable<SessionDetailWindowTurn["body"]>;

export type ReadyBody<Turn> = { body: SessionReaderBody; turn: Turn };

/** What the member typed in this turn, with tool-result transport left out. */
export function getReaderMemberText(body: SessionReaderBody): string {
	return body.userItems
		.flatMap((item) => {
			if (item.kind !== "user") return [];
			if (typeof item.content === "string") return [item.content];
			return item.content.flatMap((part) => {
				if (typeof part === "string") return part ? [part] : [];
				return part.type === "text" && part.text ? [part.text] : [];
			});
		})
		.filter((text) => text.trim().length > 0)
		.join("\n");
}
