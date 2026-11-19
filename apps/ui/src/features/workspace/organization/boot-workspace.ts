import type { Organization } from "./types";

const WORKSPACE_META_NAME = "opaline-workspace";

export function readBootOrganization(
	root: Pick<Document, "querySelector"> | undefined,
): Organization | null {
	const meta = root?.querySelector(`meta[name="${WORKSPACE_META_NAME}"]`);
	const slug = meta?.getAttribute("content");
	const id = meta?.getAttribute("data-id");
	return slug && id ? { id, slug, name: "", logo: null } : null;
}

let bootOrganization: Organization | null | undefined;

export function getBootOrganization(): Organization | null {
	if (bootOrganization === undefined)
		bootOrganization = readBootOrganization(
			typeof document === "undefined" ? undefined : document,
		);
	return bootOrganization;
}

export function resolveActiveOrganization(input: {
	readonly urlSlug: string | null;
	readonly organizations: readonly Organization[] | null | undefined;
	readonly activeOrganizationId: string | null | undefined;
	readonly optimisticActiveOrganizationId: string | null;
	readonly bootOrganization: Organization | null;
}): Organization | null {
	const { organizations } = input;
	if (input.urlSlug) {
		const listed = organizations?.find((item) => item.slug === input.urlSlug);
		if (listed) return listed;
		return !organizations && input.bootOrganization?.slug === input.urlSlug
			? input.bootOrganization
			: null;
	}
	return (
		organizations?.find((item) => item.id === input.activeOrganizationId) ??
		organizations?.find(
			(item) => item.id === input.optimisticActiveOrganizationId,
		) ??
		null
	);
}
