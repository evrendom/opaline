import type { SessionArrivalsPageSchema } from "@rudel/api-routes";
import postgres from "postgres";
import type { z } from "zod";
import { readCliConnectionListenUrl } from "../lib/cli-connection-database.js";
import { sessionArrivalChannel } from "./session-arrival-channel.js";
import {
	listSessionArrivals,
	readSessionArrivalMember,
} from "./session-arrivals.service.js";

export async function streamSessionArrivals(
	request: Request,
	organizationId: string,
	userId: string,
	since: string | undefined,
): Promise<Response> {
	// Establish the baseline before subscribing, then catch up after LISTEN is
	// active. Reconnects retain it through Last-Event-ID, closing the subscribe gap.
	const baseline =
		since ??
		(await listSessionArrivals(organizationId, userId, { organizationId }))
			.since;
	const listener = postgres(readCliConnectionListenUrl(), {
		max: 1,
		prepare: false,
		connect_timeout: 10,
		idle_timeout: 20,
	});
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array>;
	let closed = false;
	let refreshing = false;
	let refreshPending = false;
	let resume: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const sent = new Set<string>();

	function close(cancelled = false) {
		if (closed) return;
		closed = true;
		clearInterval(heartbeat);
		clearTimeout(deadline);
		request.signal.removeEventListener("abort", abort);
		resume?.();
		if (!cancelled) controller.close();
		void listener.end({ timeout: 1 }).catch(() => {});
	}
	function abort() {
		close();
	}
	async function send(page: z.infer<typeof SessionArrivalsPageSchema>) {
		if (closed) return;
		if ((controller.desiredSize ?? 0) <= 0) {
			await new Promise<void>((resolve) => {
				resume = resolve;
			});
			resume = undefined;
		}
		if (closed) return;
		controller.enqueue(
			encoder.encode(
				`id: ${baseline}\nevent: sessions\ndata: ${JSON.stringify(page)}\n\n`,
			),
		);
	}
	async function refresh() {
		refreshPending = true;
		if (closed || refreshing) return;
		refreshing = true;
		try {
			while (refreshPending && !closed) {
				refreshPending = false;
				let after: string | undefined;
				do {
					const member = await readSessionArrivalMember(organizationId, userId);
					if (!member) {
						close();
						return;
					}
					const page = await listSessionArrivals(
						organizationId,
						member.role === "owner" || member.role === "admin" ? null : userId,
						{ organizationId, since: baseline, after },
					);
					const sessions = page.sessions.filter(
						(session) => !sent.has(session.sessionId),
					);
					if (sessions.length) {
						await send({ ...page, sessions });
						for (const session of sessions) sent.add(session.sessionId);
					}
					after = page.nextCursor ?? undefined;
				} while (after && !closed);
			}
		} catch {
			close();
		} finally {
			refreshing = false;
		}
	}
	const body = new ReadableStream<Uint8Array>({
		start(streamController) {
			controller = streamController;
			request.signal.addEventListener("abort", abort, { once: true });
			if (request.signal.aborted) {
				close();
				return;
			}
			void send({ since: baseline, sessions: [], nextCursor: null });
			void listener
				.listen(
					sessionArrivalChannel(organizationId),
					() => {
						void refresh();
					},
					() => {
						void refresh();
					},
				)
				.catch(() => close());
			// Transport keepalive only: no database reads or arrival polling.
			heartbeat = setInterval(() => {
				if (!closed && (controller.desiredSize ?? 0) > 0)
					controller.enqueue(encoder.encode(": keepalive\n\n"));
			}, 5_000);
			// Reconnect below the platform's function-duration limit.
			deadline = setTimeout(() => close(), 240_000);
		},
		pull() {
			resume?.();
		},
		cancel() {
			close(true);
		},
	});
	return new Response(body, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "private, no-store, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
