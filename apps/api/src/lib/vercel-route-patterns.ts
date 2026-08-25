export const VERCEL_INGEST_PUBLIC_PATH_PATTERN =
	/^\/rpc\/ingest\/(?:commit|init|status)\/?$/u;

export const VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN =
	/^\/(?:api(?:\/.*)?|health|rpc(?:\/(?!ingestSession(?:\/|$)|ingest(?:\/|$)).*)?)$/u;
