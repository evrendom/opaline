import { useTheme } from "@/app/providers/ThemeProvider";
import { ResetPasswordForm } from "@/features/auth/ResetPasswordForm";

export function ResetPasswordApp() {
	const { resolvedTheme } = useTheme();
	const logoSrc =
		resolvedTheme === "dark" ? "/favicon-dark.svg" : "/favicon-light.svg";

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-xxl">
			<img src={logoSrc} alt="Opaline" className="h-10 w-10" />
			<ResetPasswordForm onBackToLogin={() => (window.location.href = "/")} />
		</div>
	);
}
