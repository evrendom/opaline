export function apiKeyFromHeaders(headers: Headers): string | null {
	const header = headers.get("x-api-key")?.trim();
	if (header) return header;
	const bearer = /^Bearer\s+(\S+)\s*$/iu.exec(
		headers.get("authorization") ?? "",
	)?.[1];
	return bearer ?? null;
}

export interface ApiKeyVerifier {
	verifyApiKey(input: {
		body: { key: string; permissions: Record<string, string[]> };
	}): Promise<{
		valid: boolean;
		key?: { referenceId: string } | null;
	}>;
}

export async function apiKeyUserId(
	api: ApiKeyVerifier,
	key: string | null,
): Promise<string | null> {
	if (!key) return null;
	try {
		const verification = await api.verifyApiKey({
			body: { key, permissions: { ingest: ["write"] } },
		});
		return verification.valid && verification.key
			? verification.key.referenceId
			: null;
	} catch {
		return null;
	}
}
