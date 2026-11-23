import { IconDeviceLaptop, IconMoon, IconSun } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useId } from "react";
import { useTheme } from "@/app/providers/ThemeProvider";
import { Button } from "@/app/ui/button";

const MORPH = { type: "spring", stiffness: 400, damping: 38 } as const;

const THEME_OPTIONS = [
	{ value: "system", label: "System", icon: IconDeviceLaptop },
	{ value: "light", label: "Light", icon: IconSun },
	{ value: "dark", label: "Dark", icon: IconMoon },
] as const;

/**
 * Three-way theme control as a segmented pill (system / light / dark). It
 * tracks the chosen setting, not the resolved one, so "System" is its own
 * state.
 */
export function ThemeSwitcher() {
	const { theme, setTheme } = useTheme();
	// Unique per instance so the sliding pill is scoped to this control.
	const pillId = useId();

	return (
		<fieldset className="inline-flex items-center corner-full">
			<legend className="sr-only">Theme</legend>
			{THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
				const active = theme === value;
				return (
					<Button
						key={value}
						type="button"
						size="icon-sm"
						aria-label={label}
						aria-pressed={active}
						title={label}
						onClick={() => setTheme(value)}
						className="relative"
					>
						{active ? (
							<motion.span
								layoutId={pillId}
								transition={MORPH}
								className={"absolute inset-0 corner-full bg-hover shadow-card"}
							/>
						) : null}
						<Icon aria-hidden="true" className="relative z-10 size-3.5" />
					</Button>
				);
			})}
		</fieldset>
	);
}
