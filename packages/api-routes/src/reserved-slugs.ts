/**
 * Top-level paths that cannot be used as organization slugs on opaline.so.
 *
 * Keep marketing routes inside top-level segments already reserved here. Add a
 * reservation before shipping any new top-level marketing path so organization
 * URLs can never collide with product or platform routes.
 *
 * Organization creation and slug updates enforce this list at the server
 * boundary through the Better Auth organization plugin hooks in `apps/api`.
 */
export const RESERVED_ORG_SLUGS: readonly string[] = [
	".well-known",
	"about",
	"account",
	"accounts",
	"admin",
	"administrator",
	"admln",
	"api",
	"app",
	"assets",
	"auth",
	"billing",
	"blog",
	"brand",
	"callback",
	"careers",
	"cdn",
	"changelog",
	"community",
	"contact",
	"create",
	"customers",
	"dashboard",
	"dev",
	"developers",
	"device",
	"docs",
	"documentation",
	"download",
	"downloads",
	"enterprise",
	"events",
	"explore",
	"favicon",
	"favicon.ico",
	"features",
	"feed",
	"fonts",
	"get-started",
	"health",
	"healthz",
	"help",
	"home",
	"images",
	"index",
	"integrations",
	"internal",
	"invite",
	"invites",
	"invitation",
	"jobs",
	"legal",
	"login",
	"logout",
	"mail",
	"me",
	"media",
	"new",
	"oauth",
	"open-source",
	"org",
	"orgs",
	"partners",
	"press",
	"pricing",
	"privacy",
	"product",
	"products",
	"public",
	"register",
	"releases",
	"reset-password",
	"resources",
	"resume",
	"roadmap",
	"robots",
	"robots.txt",
	"root",
	"rpc",
	"search",
	"security",
	"session",
	"sessions",
	"settings",
	"share",
	"sign-up",
	"signup",
	"sitemap",
	"sitemap.xml",
	"solutions",
	"static",
	"status",
	"support",
	"system",
	"team",
	"teams",
	"terms",
	"user",
	"users",
	"webhooks",
	"wrapped",
	"www",
];

export const ORG_SLUG_MIN_LENGTH = 2;
export const ORG_SLUG_MAX_LENGTH = 63;

const ORG_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const RESERVED_ORG_SLUG_SET = new Set(RESERVED_ORG_SLUGS);

/**
 * Validate a prospective organization slug for use as an apex path segment.
 * Slugs are lowercase DNS-label-style names and must not claim a reserved route.
 */
export function validateOrgSlug(slug: string): boolean {
	return (
		slug.length >= ORG_SLUG_MIN_LENGTH &&
		slug.length <= ORG_SLUG_MAX_LENGTH &&
		ORG_SLUG_PATTERN.test(slug) &&
		!RESERVED_ORG_SLUG_SET.has(slug)
	);
}
