import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useSyncExternalStore,
} from "react";

export type ThemeSetting = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

// index.html reads the same key before the bundle loads, so the first paint
// already has the right theme. Keep the two in sync.
const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

type ThemeContextValue = {
	/** The chosen setting; "system" follows the OS. */
	theme: ThemeSetting;
	/** What is actually on screen. */
	resolvedTheme: ResolvedTheme;
	/** Set by hosts that own the theme (the plugin widget). */
	forcedTheme?: ResolvedTheme;
	setTheme: (theme: ThemeSetting) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
	theme: "system",
	resolvedTheme: "light",
	setTheme: () => {},
});

const storedThemeListeners = new Set<() => void>();

function readStoredTheme(): ThemeSetting {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === "light" || stored === "dark") return stored;
	} catch {
		// Storage can be blocked (private mode, sandboxed iframes).
	}
	return "system";
}

function subscribeToStoredTheme(onChange: () => void) {
	storedThemeListeners.add(onChange);
	// Another tab changed the setting.
	const onStorage = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY) onChange();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		storedThemeListeners.delete(onChange);
		window.removeEventListener("storage", onStorage);
	};
}

function writeStoredTheme(theme: ThemeSetting) {
	try {
		if (theme === "system") localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Keep the in-memory choice for this page only.
	}
	for (const listener of storedThemeListeners) listener();
}

const PAGE_STORAGE_KEY = "page-theme";
const pageThemeListeners = new Set<() => void>();
let pageThemeInMemory: ThemeSetting | null = null;

function isThemeSetting(value: unknown): value is ThemeSetting {
	return value === "light" || value === "dark" || value === "system";
}

function readPageTheme(): ThemeSetting | null {
	try {
		const stored = sessionStorage.getItem(PAGE_STORAGE_KEY);
		if (isThemeSetting(stored)) return stored;
	} catch {}
	return pageThemeInMemory;
}

function subscribeToPageTheme(onChange: () => void) {
	pageThemeListeners.add(onChange);
	return () => {
		pageThemeListeners.delete(onChange);
	};
}

function writePageTheme(theme: ThemeSetting) {
	pageThemeInMemory = theme;
	try {
		sessionStorage.setItem(PAGE_STORAGE_KEY, theme);
	} catch {}
	for (const listener of pageThemeListeners) listener();
}

const readServerPageTheme = (): ThemeSetting | null => null;

function subscribeToSystemTheme(onChange: () => void) {
	const media = window.matchMedia(DARK_QUERY);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

function readSystemTheme(): ResolvedTheme {
	return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

// Server rendering (the landing-page demo) has neither storage nor a media
// query. Hydration renders with these, then React re-renders with the client's
// real values, so server and client markup always agree.
const readServerStoredTheme = (): ThemeSetting => "system";
const readServerSystemTheme = (): ResolvedTheme => "light";

function applyTheme(theme: ResolvedTheme) {
	const root = document.documentElement;
	const isDark = theme === "dark";
	if (
		root.classList.contains("dark") === isDark &&
		root.style.colorScheme === theme
	) {
		return;
	}
	// Swap every colour at once instead of letting each element's own
	// transition animate it; the reflow commits the switch before the
	// transitions come back.
	const pauseTransitions = document.createElement("style");
	pauseTransitions.textContent =
		"*,*::before,*::after{transition:none!important}";
	document.head.append(pauseTransitions);
	root.classList.toggle("dark", isDark);
	root.style.colorScheme = theme;
	window.getComputedStyle(document.body);
	setTimeout(() => pauseTransitions.remove(), 1);
}

export function ThemeProvider({
	children,
	forcedTheme,
	pageTheme,
}: {
	children: ReactNode;
	forcedTheme?: ResolvedTheme;
	pageTheme?: ResolvedTheme;
}) {
	const storedTheme = useSyncExternalStore(
		subscribeToStoredTheme,
		readStoredTheme,
		readServerStoredTheme,
	);
	const pageSetting = useSyncExternalStore(
		subscribeToPageTheme,
		readPageTheme,
		readServerPageTheme,
	);
	const theme = pageTheme ? (pageSetting ?? pageTheme) : storedTheme;
	const systemTheme = useSyncExternalStore(
		subscribeToSystemTheme,
		readSystemTheme,
		readServerSystemTheme,
	);
	const resolvedTheme =
		forcedTheme ?? (theme === "system" ? systemTheme : theme);

	useLayoutEffect(() => {
		applyTheme(resolvedTheme);
	}, [resolvedTheme]);

	const setTheme = useCallback(
		(next: ThemeSetting) => {
			if (pageTheme) writePageTheme(next);
			else writeStoredTheme(next);
		},
		[pageTheme],
	);

	const value = useMemo(
		() => ({ theme, resolvedTheme, forcedTheme, setTheme }),
		[theme, resolvedTheme, forcedTheme, setTheme],
	);

	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
}

export function useTheme() {
	return useContext(ThemeContext);
}
