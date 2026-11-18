import { type DemoRuntime, useDemoRuntime } from "@/features/demo/demo-runtime";

export function readsSessionData(
	mode: string,
	demo: Pick<DemoRuntime, "live"> | null,
): boolean {
	return mode !== "plugin" && demo?.live !== false;
}

export function useReadsSessionData(): boolean {
	return readsSessionData(import.meta.env.MODE, useDemoRuntime());
}
