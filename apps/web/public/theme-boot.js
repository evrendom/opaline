try {
	const theme = localStorage.getItem("theme");
	const dark =
		theme === "dark" ||
		(theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {}
