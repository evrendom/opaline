export const BODY_PRIORITY = {
	urgent: 0,
	visible: 1,
	near: 2,
	idle: 3,
	background: 4,
} as const;

export type BodyPriority = (typeof BODY_PRIORITY)[keyof typeof BODY_PRIORITY];

const MAX_IN_FLIGHT = 6;
const URGENT_EXTRA = 2;
const MAX_IDLE_IN_FLIGHT = 2;

type Job = {
	key: string;
	seq: number;
	start: () => void;
};

const priorities = new Map<string, BodyPriority>();
const queue: Job[] = [];
let inFlight = 0;
let idleInFlight = 0;
let seq = 0;
let idleHandle: number | null = null;

function priorityOf(key: string): BodyPriority {
	return priorities.get(key) ?? BODY_PRIORITY.near;
}

export function raiseBodyPriority(key: string, priority: BodyPriority) {
	const held = priorities.get(key);
	if (held !== undefined && held <= priority) return;
	priorities.set(key, priority);
	if (queue.some((job) => job.key === key)) pump();
}

function nextJob(): number {
	let best = -1;
	let bestPriority = Number.POSITIVE_INFINITY;
	let bestSeq = Number.POSITIVE_INFINITY;
	for (let index = 0; index < queue.length; index++) {
		const job = queue[index] as Job;
		const priority = priorityOf(job.key);
		if (
			priority < bestPriority ||
			(priority === bestPriority && job.seq < bestSeq)
		) {
			best = index;
			bestPriority = priority;
			bestSeq = job.seq;
		}
	}
	return best;
}

function pump(fromIdle = false) {
	while (queue.length > 0) {
		const index = nextJob();
		const job = queue[index] as Job;
		const priority = priorityOf(job.key);
		const cap =
			priority === BODY_PRIORITY.urgent
				? MAX_IN_FLIGHT + URGENT_EXTRA
				: MAX_IN_FLIGHT;
		if (inFlight >= cap) return;
		if (priority >= BODY_PRIORITY.idle) {
			if (idleInFlight >= MAX_IDLE_IN_FLIGHT) return;
			if (!fromIdle) {
				scheduleIdle();
				return;
			}
		}
		queue.splice(index, 1);
		job.start();
	}
}

function scheduleIdle() {
	if (idleHandle !== null) return;
	const run = () => {
		idleHandle = null;
		pump(true);
	};
	idleHandle =
		typeof requestIdleCallback === "function"
			? requestIdleCallback(run, { timeout: 500 })
			: window.setTimeout(run, 200);
}

export function scheduleBodyRequest<T>(
	key: string,
	signal: AbortSignal,
	request: () => Promise<T>,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const job: Job = {
			key,
			seq: seq++,
			start: () => {
				signal.removeEventListener("abort", onAbort);
				const idle = priorityOf(key) >= BODY_PRIORITY.idle;
				inFlight++;
				if (idle) idleInFlight++;
				let settled = false;
				const done = () => {
					if (settled) return;
					settled = true;
					inFlight--;
					if (idle) idleInFlight--;
					pump();
				};
				request().then(
					(value) => {
						done();
						resolve(value);
					},
					(error: unknown) => {
						done();
						reject(error);
					},
				);
			},
		};
		const onAbort = () => {
			const index = queue.indexOf(job);
			if (index !== -1) queue.splice(index, 1);
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		queue.push(job);
		pump();
	});
}

export function getBodySchedulerState() {
	return { inFlight, queued: queue.length };
}
