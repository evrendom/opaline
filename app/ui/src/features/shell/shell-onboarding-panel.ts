import { createContext, useContext } from "react";

export const ShellOnboardingPanelContext = createContext<HTMLElement | null>(
	null,
);
export function useShellOnboardingPanel() {
	return useContext(ShellOnboardingPanelContext);
}
