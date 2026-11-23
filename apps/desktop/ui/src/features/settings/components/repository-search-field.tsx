import { IconSearch } from "@tabler/icons-react";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/app/ui/input-group";

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
	/** Places the field (a margin, a width); its look is InputGroup's. */
	className?: string;
}) {
	return (
		<InputGroup className={className}>
			<InputGroupAddon>
				<IconSearch aria-hidden="true" />
			</InputGroupAddon>
			<InputGroupInput
				type="search"
				name={name}
				aria-label={label}
				placeholder="Find a repository…"
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</InputGroup>
	);
}
