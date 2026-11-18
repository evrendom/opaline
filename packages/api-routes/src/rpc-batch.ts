export const RPC_BATCH_PATH = "/rpc/__batch__";

export const WORKSPACE_REQUEST_HEADER = "x-opaline-workspace";

export const BATCHED_RPC_PROCEDURES: ReadonlySet<string> = new Set([
	"sessionAccess",
	"analytics/moments/access",
	"cli/updateStatus",
	"repositorySettings/list",
	"analytics/repositories/navigation",
	"analytics/sessions/lastUpload",
	"analytics/sessions/liveList",
	"analytics/sessions/uploadFailures",
]);

export function isBatchedRpcProcedure(path: readonly string[]): boolean {
	return BATCHED_RPC_PROCEDURES.has(path.join("/"));
}

export function isBatchedRpcPathname(pathname: string): boolean {
	return (
		pathname.startsWith("/rpc/") &&
		BATCHED_RPC_PROCEDURES.has(pathname.slice("/rpc/".length))
	);
}
