export type SessionTurnRowGeometry = {
	key: string;
	visibleIndex: number;
	top: number;
	bottom: number;
	adjacentToPrevious: boolean;
};

export type SessionTurnTableGeometry = {
	bodyTop: number;
	headerHeight: number;
	viewportHeight: number;
	rows: readonly SessionTurnRowGeometry[];
};

export type SessionTurnViewedGroup = {
	firstVisibleIndex: number;
	lastVisibleIndex: number;
	rowCount: number;
	top: number;
	height: number;
};

export function getSessionTurnViewedGroups(
	rows: readonly SessionTurnRowGeometry[],
	viewedRowKeys: ReadonlySet<string>,
) {
	const groups: SessionTurnViewedGroup[] = [];
	let previousViewed = false;
	for (const row of rows) {
		if (!viewedRowKeys.has(row.key)) {
			previousViewed = false;
			continue;
		}
		const previous = groups.at(-1);
		if (previous && previousViewed && row.adjacentToPrevious) {
			previous.lastVisibleIndex = row.visibleIndex;
			previous.rowCount += 1;
			previous.height = row.bottom - previous.top;
		} else {
			groups.push({
				firstVisibleIndex: row.visibleIndex,
				lastVisibleIndex: row.visibleIndex,
				rowCount: 1,
				top: row.top,
				height: row.bottom - row.top,
			});
		}
		previousViewed = true;
	}
	return groups;
}

export function getSessionTurnViewedDirection(
	geometry: SessionTurnTableGeometry,
	groups: readonly SessionTurnViewedGroup[],
	scrollTop: number,
): "above" | "below" | undefined {
	const first = groups[0];
	const last = groups.at(-1);
	if (!first || !last) return undefined;
	if (
		geometry.bodyTop + last.top + last.height <
		scrollTop + geometry.headerHeight
	) {
		return "above";
	}
	if (geometry.bodyTop + first.top > scrollTop + geometry.viewportHeight) {
		return "below";
	}
	return undefined;
}

export function areSessionTurnTableGeometriesEqual(
	left: SessionTurnTableGeometry,
	right: SessionTurnTableGeometry,
) {
	return (
		left.bodyTop === right.bodyTop &&
		left.headerHeight === right.headerHeight &&
		left.viewportHeight === right.viewportHeight &&
		left.rows.length === right.rows.length &&
		left.rows.every((row, index) => {
			const other = right.rows[index];
			return (
				other !== undefined &&
				row.key === other.key &&
				row.visibleIndex === other.visibleIndex &&
				row.top === other.top &&
				row.bottom === other.bottom &&
				row.adjacentToPrevious === other.adjacentToPrevious
			);
		})
	);
}
