import { z } from "zod";

export const SessionArrivalsInputSchema = z.object({
	organizationId: z.string().min(1).max(200),
	// Omit on the first request to establish a server-clock baseline.
	since: z.string().datetime().optional(),
	after: z.string().min(1).max(200).optional(),
});

export const SessionArrivalsPageSchema = z.object({
	since: z.string().datetime(),
	sessions: z.array(z.object({ sessionId: z.string(), userName: z.string() })),
	nextCursor: z.string().nullable(),
});

export type SessionArrival = z.infer<
	typeof SessionArrivalsPageSchema
>["sessions"][number];
