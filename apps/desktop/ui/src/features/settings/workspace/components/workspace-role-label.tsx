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
				/* design-escape-ok(opacity): no role renders this; warning at 10% light, 15% dark */ "inline-flex h-5 items-center gap-xs corner-full bg-warning/10 px-m text-body-m font-medium text-warning dark:bg-warning/15"
			}
		>
			<IconCrown aria-hidden="true" className="size-3" />
			Owner
		</span>
	);
}
