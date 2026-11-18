import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import { useSearchParams } from "react-router-dom";

type UsageSelection = {
	selected: boolean;
	setSelected: (selected: boolean) => void;
};

const UsageSelectionContext = createContext<UsageSelection | null>(null);

export function UsageSelectionProvider({ children }: { children: ReactNode }) {
	const [params] = useSearchParams();
	const [selected, setSelected] = useState(() => !params.get("metric"));
	const value = useMemo(() => ({ selected, setSelected }), [selected]);
	return (
		<UsageSelectionContext.Provider value={value}>
			{children}
		</UsageSelectionContext.Provider>
	);
}

export function useUsageSelection(): UsageSelection {
	const shared = useContext(UsageSelectionContext);
	const [params] = useSearchParams();
	const [selected, setSelected] = useState(() => !params.get("metric"));
	return shared ?? { selected, setSelected };
}

export function useSharedUsageSelected(): boolean {
	return useContext(UsageSelectionContext)?.selected === true;
}
