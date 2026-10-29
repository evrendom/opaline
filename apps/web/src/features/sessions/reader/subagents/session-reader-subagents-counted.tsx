import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";

type SubagentsCounted = {
	setWithSubagents: (value: boolean) => void;
	withSubagents: boolean;
};

const SubagentsCountedContext = createContext<SubagentsCounted | null>(null);

export function SubagentsCountedProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [withSubagents, setWithSubagents] = useState(true);
	const value = useMemo(
		() => ({ setWithSubagents, withSubagents }),
		[withSubagents],
	);
	return (
		<SubagentsCountedContext.Provider value={value}>
			{children}
		</SubagentsCountedContext.Provider>
	);
}

export function useSubagentsCounted(): boolean {
	return useContext(SubagentsCountedContext)?.withSubagents ?? true;
}

export function useSubagentsCountedChoice(): SubagentsCounted | null {
	return useContext(SubagentsCountedContext);
}
