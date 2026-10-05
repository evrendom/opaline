import { useEffect, useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { isValidAuthEmail, normalizeAuthEmail } from "./email-code-auth";

export const PASSWORD_SIGN_IN_CHECK_DELAY_MS = 400;
export const PASSWORD_SIGN_IN_RETRY_DELAY_MS = 3_000;

const AvailabilitySchema = z.object({ available: z.boolean() });

/** `null` when the server gave no answer (network error, 429, bad body). */
async function checkPasswordSignIn(
	email: string,
	signal: AbortSignal,
): Promise<boolean | null> {
	try {
		const { data } = await authClient.$fetch("/password-sign-in/available", {
			method: "POST",
			body: { email },
			signal,
		});
		return AvailabilitySchema.safeParse(data).data?.available ?? null;
	} catch {
		return null;
	}
}

/**
 * Whether the typed email may sign in with a password (PASSWORD_AUTH_EMAILS).
 * The server is asked once the email has been valid and unchanged for a moment.
 * A failed lookup is unknown, not "no": it is retried once after a short
 * backoff and again whenever the window regains focus, so a rate-limited
 * reviewer on a shared IP still gets the password field.
 */
export function usePasswordSignIn(email: string): boolean {
	const normalizedEmail = normalizeAuthEmail(email);
	const hasValidEmail = isValidAuthEmail(normalizedEmail);
	const [answer, setAnswer] = useState<{
		available: boolean;
		email: string;
	} | null>(null);

	useEffect(() => {
		if (!hasValidEmail) return;
		const controller = new AbortController();
		const timers = new Set<number>();
		let answered = false;
		let inFlight = false;
		let backoffUsed = false;

		function schedule(delay: number) {
			const timer = window.setTimeout(() => {
				timers.delete(timer);
				check();
			}, delay);
			timers.add(timer);
		}

		function check() {
			if (answered || inFlight) return;
			inFlight = true;
			void checkPasswordSignIn(normalizedEmail, controller.signal).then(
				(available) => {
					inFlight = false;
					if (controller.signal.aborted) return;
					if (available === null) {
						if (!backoffUsed) {
							backoffUsed = true;
							schedule(PASSWORD_SIGN_IN_RETRY_DELAY_MS);
						}
						return;
					}
					answered = true;
					setAnswer({ available, email: normalizedEmail });
				},
			);
		}

		schedule(PASSWORD_SIGN_IN_CHECK_DELAY_MS);
		window.addEventListener("focus", check);
		return () => {
			controller.abort();
			for (const timer of timers) window.clearTimeout(timer);
			window.removeEventListener("focus", check);
		};
	}, [hasValidEmail, normalizedEmail]);

	return (
		hasValidEmail &&
		answer?.email === normalizedEmail &&
		answer.available === true
	);
}
