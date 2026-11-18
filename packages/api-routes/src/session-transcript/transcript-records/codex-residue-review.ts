import { z } from "zod";
import raw from "./codex-residue-review.json" with { type: "json" };

const residueReviewSchema = z.object({
	agreements: z.array(
		z.object({
			path: z.string().min(1),
			reviewedPath: z.string().min(1),
			decision: z.enum(["map_existing", "new_fact", "ignore"]),
			fact: z.string().optional(),
		}),
	),
	pending: z.array(
		z.object({
			path: z.string().min(1),
			reviewedPath: z.string().min(1),
			status: z.literal("pending"),
			sol: z.string().min(1),
			sonnet: z.string().min(1),
		}),
	),
});

export const CODEX_RESIDUE_REVIEW = residueReviewSchema.parse(raw);
