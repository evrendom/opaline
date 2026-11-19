export class TranscriptRecordsDeadlineExceededError extends Error {
	constructor() {
		super("Session indexing exceeded its deadline");
		this.name = "TranscriptRecordsDeadlineExceededError";
	}
}

export function createTranscriptRecordsDeadline(input: {
	readonly deadlineAt: number | undefined;
	readonly now: () => number;
	readonly signal: AbortSignal | undefined;
}) {
	const controller = new AbortController();
	const expire = () =>
		controller.abort(new TranscriptRecordsDeadlineExceededError());
	const cancel = () => controller.abort(input.signal?.reason);
	const remaining =
		input.deadlineAt === undefined ? undefined : input.deadlineAt - input.now();
	const timer =
		remaining === undefined
			? undefined
			: setTimeout(expire, Math.max(0, remaining));
	input.signal?.addEventListener("abort", cancel, { once: true });
	if (input.signal?.aborted) cancel();
	const assertActive = () => {
		if (input.deadlineAt !== undefined && input.now() >= input.deadlineAt) {
			expire();
		}
		controller.signal.throwIfAborted();
	};
	return {
		assertActive,
		dispose: () => {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", cancel);
		},
		signal: controller.signal,
		async wait<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
			assertActive();
			let onAbort = () => {};
			try {
				const aborted = new Promise<never>((_, reject) => {
					onAbort = () => reject(controller.signal.reason);
					controller.signal.addEventListener("abort", onAbort, { once: true });
				});
				const result = await Promise.race([operation(), aborted]);
				assertActive();
				return result;
			} catch (error) {
				assertActive();
				throw error;
			} finally {
				controller.signal.removeEventListener("abort", onAbort);
			}
		},
	};
}
