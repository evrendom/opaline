import type { WorkspaceFeatureKey } from "@rudel/api-routes";
import type postgres from "postgres";

type Environment = Readonly<Record<string, string | undefined>>;

export function isSelfHosted(env: Environment = process.env): boolean {
	return env.OPALINE_SELF_HOSTED === "1";
}

export const SELF_HOSTED_DISABLED_ENV = [
	"STRIPE_SECRET_KEY",
	"STRIPE_WEBHOOK_SECRET",
	"STRIPE_BILLING_MODE",
	"CRM_ACCESS_TOKEN",
	"SLACK_WEBHOOK_URL",
	"POSTHOG_ENABLED",
	"POSTHOG_KEY",
	"POSTHOG_HOST",
	"VITE_POSTHOG_ENABLED",
	"VITE_POSTHOG_KEY",
	"VITE_POSTHOG_HOST",
	"SENTRY_API_ENABLED",
	"SENTRY_API_DSN",
] as const;

export function disableExternalProviders(
	env: Record<string, string | undefined>,
): string[] {
	const removed = SELF_HOSTED_DISABLED_ENV.filter(
		(name) => env[name] !== undefined,
	);
	for (const name of removed) delete env[name];
	return removed;
}

const FEATURE_PROVIDERS: Record<
	WorkspaceFeatureKey,
	(env: Environment) => boolean
> = {
	agent_traces: () => true,
	moments: () => true,
	run_question_tags: (env) =>
		Boolean(env.SUBQ_API_KEY?.trim() || env.TYPESAFE_API_KEY?.trim()),
	moment_observations: (env) => Boolean(env.ANTHROPIC_API_KEY?.trim()),
	frustration_check: (env) => Boolean(env.SUBQ_API_KEY?.trim()),
	run_ci: (env) =>
		Boolean(
			env.GITHUB_REPOSITORY_APP_ID?.trim() &&
				env.GITHUB_REPOSITORY_APP_PRIVATE_KEY?.trim(),
		),
};

export function selfHostedFeatureDefault(
	feature: WorkspaceFeatureKey,
	env: Environment = process.env,
): boolean {
	return FEATURE_PROVIDERS[feature](env);
}

export async function isSelfHostedAdmin(
	sql: postgres.Sql,
	userId: string,
): Promise<boolean> {
	const [row] = await sql<{ admin: boolean }[]>`
		SELECT EXISTS (
			SELECT 1 FROM member m
			WHERE m.user_id = ${userId}
				AND m.role IN ('owner', 'admin')
				AND m.organization_id = (
					SELECT id FROM organization ORDER BY created_at, id LIMIT 1
				)
		) AS admin
	`;
	return row?.admin === true;
}
