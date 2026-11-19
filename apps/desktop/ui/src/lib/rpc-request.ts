import { BatchLinkPlugin } from "@orpc/client/plugins";
import {
	isBatchedRpcProcedure,
	RPC_BATCH_PATH,
	WORKSPACE_REQUEST_HEADER,
} from "@rudel/api-routes/rpc-batch";
import { getWorkspaceSlugFromPath } from "@/app/routes";

export function workspaceRequestHeaders(
	pathname: string,
): Record<string, string> {
	const slug = getWorkspaceSlugFromPath(pathname);
	return slug ? { [WORKSPACE_REQUEST_HEADER]: slug } : {};
}

export function createRpcBatchLinkPlugin() {
	return new BatchLinkPlugin({
		mode: "streaming",
		url: () => new URL(RPC_BATCH_PATH, window.location.origin).href,
		groups: [
			{
				condition: ({ path }) => isBatchedRpcProcedure(path),
				context: {},
			},
		],
	});
}
