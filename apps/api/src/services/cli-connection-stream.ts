import {
	type CliConnectionSnapshot,
	isCliConnectionTerminal,
} from "@rudel/api-routes";
import postgres from "postgres";
import { readCliConnectionListenUrl } from "../lib/cli-connection-database.js";
import {
	cliConnectionChannel,
	readBrowserCliConnection,
} from "./cli-connection.service.js";

export { readCliConnectionListenUrl } from "../lib/cli-connection-database.js";

export async function streamCliConnection(
	request: Request,
	id: string,
	browserToken: string,
): Promise<Response> {
	const initial = await readBrowserCliConnection(id, browserToken);
	const listener = postgres(readCliConnectionListenUrl(), {
		max: 1,
		prepare: false,
		connect_timeout: 10,
		idle_timeout: 20,
	});
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array>;
	let closed = false;
	let latest: CliConnectionSnapshot | undefined;
	let refreshPending = false;
	let refreshing = false;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;

	function abort(): void {
		close();
	}
	function close(cancelled = false): void {
		if (closed) return;
		closed = true;
		clearInterval(heartbeat);
		clearTimeout(deadline);
		request.signal.removeEventListener("abort", abort);
		if (!cancelled) controller.close();
		void listener.end({ timeout: 1 }).catch(() => {});
	}
	function send(snapshot: CliConnectionSnapshot): void {
		if (
			closed ||
			(latest?.revision === snapshot.revision &&
				latest?.state === snapshot.state)
		)
			return;
		if ((controller.desiredSize ?? 0) <= 0) {
			close();
			return;
		}
		latest = snapshot;
		controller.enqueue(
			encoder.encode(
				`id: ${snapshot.revision}\nevent: connection\ndata: ${JSON.stringify(snapshot)}\n\n`,
			),
		);
		if (isCliConnectionTerminal(snapshot.state)) close();
	}
	async function refresh(): Promise<void> {
		refreshPending = true;
		if (refreshing || closed) return;
		refreshing = true;
		try {
			while (refreshPending && !closed) {
				refreshPending = false;
				send(await readBrowserCliConnection(id, browserToken));
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
			if (isCliConnectionTerminal(initial.state)) {
				send(initial);
				return;
			}
			// Subscribe before reading, including on database reconnect, to avoid missing a commit.
			void listener
				.listen(
					cliConnectionChannel(id),
					() => {
						void refresh();
					},
					() => {
						void refresh();
					},
				)
				.catch(() => close());
			heartbeat = setInterval(() => {
				if (Date.now() >= Date.parse(initial.expiresAt)) {
					send({ ...(latest ?? initial), state: "expired" });
				} else if (!closed && (controller.desiredSize ?? 0) > 0) {
					controller.enqueue(encoder.encode(": keepalive\n\n"));
				} else {
					close();
				}
				// Stay below Bun.serve's default ten-second idle timeout.
			}, 5_000);
			deadline = setTimeout(close, 240_000);
		},
		cancel() {
			close(true);
		},
	});
	return new Response(body, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-store, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
