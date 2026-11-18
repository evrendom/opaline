import { useCallback, useState } from "react";

const picked = new Map<string, string | null>();

export function useRememberedPick(
	key: string | undefined,
): [string | null, (next: string | null) => void] {
	const [value, setValue] = useState<string | null>(() =>
		key ? (picked.get(key) ?? null) : null,
	);
	const set = useCallback(
		(next: string | null) => {
			if (key) picked.set(key, next);
			setValue(next);
		},
		[key],
	);
	return [value, set];
}

const pickedThings = new Map<
	string,
	readonly { key: string; thing: string | null }[]
>();

export function useRememberedLits<
	T extends { key: string; thing: string | null },
>(key: string | undefined): [readonly T[], (next: readonly T[]) => void] {
	const [value, setValue] = useState<readonly T[]>(() =>
		key ? ((pickedThings.get(key) as readonly T[] | undefined) ?? []) : [],
	);
	const set = useCallback(
		(next: readonly T[]) => {
			if (key) pickedThings.set(key, next);
			setValue(next);
		},
		[key],
	);
	return [value, set];
}
