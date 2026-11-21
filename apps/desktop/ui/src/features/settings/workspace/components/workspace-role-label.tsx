import { IconCrown, IconShield, IconUser } from "@tabler/icons-react";

// Role marks: an icon beside each assignable role, and
// an orange badge for the owner, who can't be reassigned.
export function WorkspaceRoleLabel({ value }: { value: "member" | "admin" }) {
	const Icon = value === "admin" ? IconShield : IconUser;
	return (
		<span className="flex items-center gap-s">
			<Icon aria-hidden="true" className="size-3.5 shrink-0 text-ink-3" />
			{value === "admin" ? "Admin" : "Member"}
		</span>
	);
}

export function WorkspaceOwnerBadge() {
	return (
		<span
			className={
				/* design-escape-ok(colour): shipped value; orange-500/10 on orange-600 text, orange-600/15 on orange-400 in dark */ "inline-flex h-5 items-center gap-xs corner-full bg-orange-500/10 px-m text-body-m font-medium text-orange-600 dark:bg-orange-600/15 dark:text-orange-400"
			}
		>
			<IconCrown aria-hidden="true" className="size-3" />
			Owner
		</span>
	);
}
