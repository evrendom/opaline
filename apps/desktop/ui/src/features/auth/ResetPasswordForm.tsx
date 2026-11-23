import { useState } from "react";
import { Button } from "@/app/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/ui/card";
import { Input } from "@/app/ui/input";
import { Label } from "@/app/ui/label";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type FeedbackState = {
	kind: "error" | "success";
	message: string;
} | null;

export function ResetPasswordForm({
	onBackToLogin,
}: {
	onBackToLogin: () => void;
}) {
	const token = new URLSearchParams(window.location.search).get("token");
	const invalidToken = new URLSearchParams(window.location.search).get("error");
	const [password, setPassword] = useState("");
	const [feedback, setFeedback] = useState<FeedbackState>(
		invalidToken
			? {
					kind: "error",
					message: "This reset link is invalid or expired.",
				}
			: null,
	);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();

		if (!token) {
			setFeedback({
				kind: "error",
				message: "This reset link is invalid or expired.",
			});
			return;
		}

		setFeedback(null);
		setLoading(true);

		const { error } = await authClient.resetPassword({
			newPassword: password,
			token,
		});

		setLoading(false);

		if (error) {
			setFeedback({
				kind: "error",
				message: error.message ?? "Password reset failed",
			});
			return;
		}

		setFeedback({
			kind: "success",
			message: "Your password has been reset. You can now sign in.",
		});
		setPassword("");
	}

	return (
		<Card className="w-full max-w-sm">
			<CardHeader>
				<CardTitle>Reset password</CardTitle>
				<CardDescription>Enter your new password</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-xl">
					<form onSubmit={handleSubmit} className="flex flex-col gap-xl">
						<div className="flex flex-col gap-m">
							<Label htmlFor="new-password">New password</Label>
							<Input
								id="new-password"
								name="newPassword"
								type="password"
								autoComplete="new-password"
								value={password}
								onChange={(e) => {
									setPassword(e.target.value);
									if (feedback?.kind === "error") {
										setFeedback(null);
									}
								}}
								required
								minLength={8}
								disabled={!token || loading}
							/>
						</div>
						{feedback ? (
							<div
								role={feedback.kind === "error" ? "alert" : "status"}
								aria-live="polite"
								className={cn(
									"corner-xl px-l py-m text-body-xl ring-1",
									feedback.kind === "error"
										? "bg-error-tint text-error ring-error-line"
										: "bg-inset text-ink-3 ring-line-soft",
								)}
							>
								{feedback.message}
							</div>
						) : null}
						<Button
							variant="primary"
							type="submit"
							disabled={loading || !token}
						>
							{loading ? "Resetting password..." : "Reset password"}
						</Button>
					</form>

					<Button
						type="button"
						variant="secondary"
						size="md"
						onClick={onBackToLogin}
						className="self-start"
					>
						Back to sign in
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
