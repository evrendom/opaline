import { BatchHandlerPlugin } from "@orpc/server/plugins";
import type {
	StandardHandleResult,
	StandardHandlerInterceptorOptions,
} from "@orpc/server/standard";
import {
	isBatchedRpcPathname,
	RPC_BATCH_PATH,
} from "@rudel/api-routes/rpc-batch";
import { readRequestedWorkspace } from "./request-workspace.js";

interface WorkspaceRequestContext {
	requestedWorkspace?: string | null;
}

export function createRpcBatchPlugin<T extends WorkspaceRequestContext>() {
	return new BatchHandlerPlugin<T>({
		mapRequestItem: (request, { request: batch }) => ({
			...request,
			url: isBatchedRpcPathname(request.url.pathname)
				? request.url
				: new URL(`${RPC_BATCH_PATH}/refused`, request.url),
			headers: { ...batch.headers, ...request.headers },
		}),
	});
}

export function readWorkspaceFromRequest<T extends WorkspaceRequestContext>(
	options: StandardHandlerInterceptorOptions<T> & {
		next(
			options?: StandardHandlerInterceptorOptions<T>,
		): Promise<StandardHandleResult>;
	},
): Promise<StandardHandleResult> {
	const { next, ...rest } = options;
	return next({
		...rest,
		context: {
			...rest.context,
			requestedWorkspace: readRequestedWorkspace(rest.request.headers),
		},
	});
}
