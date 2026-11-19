import {
	ORG_SLUG_MAX_LENGTH,
	RESERVED_ORG_SLUGS,
	validateOrgSlug,
} from "@rudel/api-routes/reserved-slugs";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface SlugAvailability {
	status: "available" | "current" | "checking" | "invalid" | "taken" | "error";
	message: string;
}

export function useWorkspaceSlugAvailability(
	slug: string,
	currentSlug: string | undefined,
	enabled: boolean,
): SlugAvailability {
	const [checked, setChecked] = useState<{
		slug: string;
		status: "available" | "taken" | "error";
	} | null>(null);
	useEffect(() => {
		if (!enabled || slug === currentSlug || !validateOrgSlug(slug)) return;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			void authClient.organization
				.checkSlug({ slug })
				.then(({ data, error }) => {
					if (cancelled) return;
					setChecked({
						slug,
						status: data?.status
							? "available"
							: error?.code === "ORGANIZATION_SLUG_ALREADY_TAKEN"
								? "taken"
								: "error",
					});
				})
				.catch(() => {
					if (!cancelled) setChecked({ slug, status: "error" });
				});
		}, 350);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [slug, currentSlug, enabled]);

	if (!validateOrgSlug(slug))
		return {
			status: "invalid",
			message: RESERVED_ORG_SLUGS.includes(slug)
				? "This workspace URL is reserved. Choose another."
				: "Use 2–63 lowercase letters, numbers or hyphens. Start and end with a letter or number.",
		};
	if (slug === currentSlug)
		return {
			status: "current",
			message: "This is your current workspace URL.",
		};
	if (checked?.slug !== slug)
		return { status: "checking", message: "Checking availability…" };
	return {
		status: checked.status,
		message:
			checked.status === "available"
				? "This workspace URL is available."
				: checked.status === "taken"
					? "This workspace URL is taken. Choose another."
					: "Could not check availability. We’ll check again when you save.",
	};
}

export function suggestWorkspaceSlug(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, ORG_SLUG_MAX_LENGTH)
		.replace(/^-+|-+$/g, "");
}
