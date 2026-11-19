import { z } from "zod";
import { CliConnectionIdSchema } from "../../../../../packages/api-routes/src/cli-connection";

export const CLI_AUTHORIZATION_STORAGE_KEY = "opaline.cli-authorization";
export const CLI_SETUP_PATH = "/welcome";
const CliAuthorizationSchema = z.object({
	id: CliConnectionIdSchema,
	userCode: z.string().regex(/^[A-Za-z0-9-]{4,32}$/u),
});
export type CliAuthorization = z.infer<typeof CliAuthorizationSchema>;

export function readCliConnectionId(search: string): string | null {
	const parsed = CliConnectionIdSchema.safeParse(
		new URLSearchParams(search).get("connect"),
	);
	return parsed.success ? parsed.data : null;
}

export function readCliAuthorization(search: string): CliAuthorization | null {
	const params = new URLSearchParams(search);
	const parsed = CliAuthorizationSchema.safeParse({
		id: params.get("connect"),
		userCode: params.get("user_code"),
	});
	return parsed.success ? parsed.data : null;
}

export function readStoredCliAuthorization(
	value: string | null,
): CliAuthorization | null {
	try {
		const parsed = CliAuthorizationSchema.safeParse(
			JSON.parse(value ?? "null"),
		);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function cliAuthorizationUrl(
	authorization: CliAuthorization,
	origin: string,
): string {
	return cliSetupUrl(authorization.id, origin, authorization.userCode);
}

export function cliSetupUrl(
	id: string,
	origin: string,
	userCode?: string,
): string {
	const url = new URL(CLI_SETUP_PATH, origin);
	url.searchParams.set("connect", id);
	if (userCode) url.searchParams.set("user_code", userCode);
	return url.toString();
}
