import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";

afterEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	document.documentElement.classList.remove("dark");
	document.documentElement.style.colorScheme = "";
});

describe("ThemeProvider pageTheme", () => {
	it("starts dark and switches for the page without changing the saved setting", () => {
		localStorage.setItem("theme", "light");
		const { result } = renderHook(() => useTheme(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<ThemeProvider pageTheme="dark">{children}</ThemeProvider>
			),
		});
		expect(result.current.resolvedTheme).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		act(() => result.current.setTheme("light"));
		expect(result.current.resolvedTheme).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(localStorage.getItem("theme")).toBe("light");

		expect(sessionStorage.getItem("page-theme")).toBe("light");
		const reopened = renderHook(() => useTheme(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<ThemeProvider pageTheme="dark">{children}</ThemeProvider>
			),
		});
		expect(reopened.result.current.resolvedTheme).toBe("light");

		act(() => result.current.setTheme("dark"));
		expect(result.current.resolvedTheme).toBe("dark");
		expect(localStorage.getItem("theme")).toBe("light");
	});

	it("follows the saved setting without a page theme, whatever the page chose", () => {
		localStorage.setItem("theme", "dark");
		sessionStorage.setItem("page-theme", "light");
		const { result } = renderHook(() => useTheme(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<ThemeProvider>{children}</ThemeProvider>
			),
		});
		expect(result.current.resolvedTheme).toBe("dark");
	});
});
