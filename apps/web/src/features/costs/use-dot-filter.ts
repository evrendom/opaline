import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { DotPick } from "./cost-hover-date";

const PREVIEW_SETTLE_MS = 120;

export type DotFilterRange = { start: string; end: string };

function within(
	day: DotPick | null,
	range: { startDate: string; endDate: string },
): DotFilterRange | null {
	if (!day) return null;
	const start = day.date > range.startDate ? day.date : range.startDate;
	const end = day.end < range.endDate ? day.end : range.endDate;
	return start <= end ? { start, end } : null;
}

function sameDay(left: DotPick | null, right: DotPick | null) {
	return left?.date === right?.date && left?.end === right?.end;
}

export function useDotFilter(range: { startDate: string; endDate: string }) {
	const [searchParams, setSearchParams] = useSearchParams();
	const pickParam = searchParams.get("pick");
	const [pending, setPending] = useState<{ param: string | null } | null>(null);
	if (pending && pending.param === pickParam) setPending(null);
	const shownPick = pending ? pending.param : pickParam;
	const picked = useMemo(() => {
		const [date, end] = shownPick?.split("..") ?? [];
		return date && end ? { date, end } : null;
	}, [shownPick]);
	const dotPick = useMemo(
		() => ({
			picked,
			pick: (next: DotPick | null) => {
				const param = next ? `${next.date}..${next.end}` : null;
				setPending({ param });
				setSearchParams(
					(params) => {
						if (param) params.set("pick", param);
						else params.delete("pick");
						return params;
					},
					{ replace: true },
				);
			},
		}),
		[picked, setSearchParams],
	);

	const [previewed, setPreviewed] = useState<DotPick | null>(null);
	const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (settle.current) clearTimeout(settle.current);
		},
		[],
	);
	const preview = useCallback((next: DotPick | null) => {
		if (settle.current) clearTimeout(settle.current);
		const apply = () =>
			setPreviewed((current) => (sameDay(current, next) ? current : next));
		if (next === null) {
			settle.current = null;
			apply();
			return;
		}
		settle.current = setTimeout(apply, PREVIEW_SETTLE_MS);
	}, []);

	const { startDate, endDate } = range;
	const pickedRange = useMemo(
		() => within(picked, { startDate, endDate }),
		[picked, startDate, endDate],
	);
	const shownRange = useMemo(
		() => within(previewed ?? picked, { startDate, endDate }),
		[previewed, picked, startDate, endDate],
	);
	return { dotPick, pickedRange, preview, shownRange };
}
