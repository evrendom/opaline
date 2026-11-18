import { lazy } from "react";
import { useSearchParams } from "react-router-dom";
import { routeLoaders } from "@/app/route-loaders";
import { McpPageView } from "@/features/mcp/mcp-page-view";

const WorkspaceSetupPage = lazy(() =>
	routeLoaders.workspaceSetup().then((module) => ({
		default: module.WorkspaceSetupPage,
	})),
);

const MCP_PARAM = "mcp";
const PICK_PARAMS = ["setup", "tool", "pickedRun", "pickedCall"];

export function McpPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const name = searchParams.get(MCP_PARAM);
	function select(next: string | null) {
		const params = new URLSearchParams(searchParams);
		for (const key of PICK_PARAMS) params.delete(key);
		if (next) params.set(MCP_PARAM, next);
		else params.delete(MCP_PARAM);
		setSearchParams(params);
	}
	if (name)
		return (
			<WorkspaceSetupPage
				name={name}
				onBackToList={() => select(null)}
				section="mcp"
			/>
		);
	return <McpPageView onSelect={select} />;
}
