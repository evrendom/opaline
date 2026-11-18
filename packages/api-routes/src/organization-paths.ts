import { validateOrgSlug } from "./reserved-slugs.js";

const SAFE_RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\]*$/u;
const ENCODED_AMBIGUOUS_CHARACTER_PATTERN = /%(?:2e|2f|5c|[01][0-9a-f]|7f)/iu;
const RELATIVE_PATH_BASE = "https://opaline.invalid";

export function buildOrganizationPath(
	organizationSlug: string,
	organizationRelativePath = "",
): string {
	if (!validateOrgSlug(organizationSlug)) {
		throw new Error(`Invalid organization slug: ${organizationSlug}`);
	}

	if (
		!SAFE_RELATIVE_PATH_PATTERN.test(organizationRelativePath) ||
		containsControlCharacter(organizationRelativePath) ||
		ENCODED_AMBIGUOUS_CHARACTER_PATTERN.test(
			organizationRelativePath.split(/[?#]/u, 1)[0] ?? "",
		)
	) {
		throw new Error(
			`Invalid organization-relative path: ${organizationRelativePath}`,
		);
	}

	if (organizationRelativePath.length === 0) {
		return `/${organizationSlug}`;
	}

	return organizationRelativePath.startsWith("?") ||
		organizationRelativePath.startsWith("#")
		? `/${organizationSlug}${organizationRelativePath}`
		: `/${organizationSlug}/${organizationRelativePath}`;
}

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 31 || code === 127) {
			return true;
		}
	}

	return false;
}

export function getOrganizationSlugFromPath(pathname: string): string | null {
	const firstPathSegment = pathname.match(/^\/([^/]+)(?:\/|$)/u)?.[1];
	if (!firstPathSegment) {
		return null;
	}

	try {
		const decodedSegment = decodeURIComponent(firstPathSegment);
		if (decodedSegment !== firstPathSegment) {
			return null;
		}

		return validateOrgSlug(decodedSegment) ? decodedSegment : null;
	} catch {
		return null;
	}
}

export function resolveOrganizationPostAuthPath(
	organizationSlug: string,
	destination: string,
): string | null {
	if (
		!destination.startsWith("/") ||
		destination.startsWith("//") ||
		destination.includes("\\") ||
		containsControlCharacter(destination) ||
		ENCODED_AMBIGUOUS_CHARACTER_PATTERN.test(
			destination.split(/[?#]/u, 1)[0] ?? "",
		)
	) {
		return null;
	}

	let destinationUrl: URL;
	try {
		destinationUrl = new URL(destination, RELATIVE_PATH_BASE);
	} catch {
		return null;
	}

	if (destinationUrl.origin !== RELATIVE_PATH_BASE) {
		return null;
	}

	if (getOrganizationSlugFromPath(destinationUrl.pathname)) {
		return destination;
	}

	const destinationSuffix = `${destinationUrl.search}${destinationUrl.hash}`;
	if (
		destinationUrl.pathname === "/" ||
		destinationUrl.pathname === "/dashboard"
	) {
		return `${buildOrganizationPath(organizationSlug)}${destinationSuffix}`;
	}

	if (
		destinationUrl.pathname === "/dashboard/sessions" ||
		destinationUrl.pathname.startsWith("/dashboard/sessions/")
	) {
		return buildOrganizationPath(
			organizationSlug,
			`${destinationUrl.pathname.slice("/dashboard/".length)}${destinationSuffix}`,
		);
	}

	for (const shellSegment of ["team", "settings"]) {
		if (
			destinationUrl.pathname === `/${shellSegment}` ||
			destinationUrl.pathname.startsWith(`/${shellSegment}/`)
		) {
			return buildOrganizationPath(
				organizationSlug,
				`${destinationUrl.pathname.slice(1)}${destinationSuffix}`,
			);
		}
	}

	return destination;
}
