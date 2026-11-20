import { IconSearch } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import "@/features/settings/sessions/sessions-settings.css";

/** The "Find a repository…" field above a repository table (sessions
 *  settings, GitHub repositories, repositories on this Mac). */
export function RepositorySearchField({
	name,
	label = "Find a repository",
	value,
	onChange,
	className,
}: {
	name: string;
	label?: string;
	value: string;
	onChange: (value: string) => void;
	className?: string;
}) {
	return (
		<label className={cn("sessions-settings-search", className)}>
			<IconSearch size={16} aria-hidden="true" />
			<input
				type="search"
				name={name}
				aria-label={label}
				placeholder="Find a repository…"
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</label>
	);
}
