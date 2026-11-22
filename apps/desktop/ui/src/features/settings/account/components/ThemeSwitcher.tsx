import { IconDeviceLaptop, IconMoon, IconSun } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useId } from "react";
import { useTheme } from "@/app/providers/ThemeProvider";
import { cn } from "@/lib/utils";

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
					<button
						key={value}
						type="button"
						aria-label={label}
						aria-pressed={active}
						title={label}
						onClick={() => setTheme(value)}
						className={cn(
							"relative flex size-7 items-center justify-center",
							"corner-full",
							"focus-outline transition-colors",
							active ? "text-ink" : "text-ink-4 hover:text-ink",
						)}
					>
						{active ? (
							<motion.span
								layoutId={pillId}
								transition={MORPH}
								className={
									/* design-escape-ok(opacity,colour): shipped value; input/50, line-strong at 50% and oklch(1 0 0 / 7.5%) in dark */ "absolute inset-0 corner-full bg-line/50 dark:bg-[oklch(1_0_0/7.5%)] shadow-card"
								}
							/>
						) : null}
						<Icon aria-hidden="true" className="relative z-10 size-3.5" />
					</button>
				);
			})}
		</fieldset>
	);
}
