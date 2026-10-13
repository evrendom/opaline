import { oc } from "@orpc/contract";
import { z } from "zod";

export const UsageDigestKindSchema = z.enum(["daily", "weekly"]);

/** The member's digest choices, one row per workspace they belong to. */
export const UsageDigestPreferencesSchema = z.object({
	workspaces: z.array(
		z.object({
			organizationId: z.string(),
			organizationName: z.string(),
			daily: z.boolean(),
			weekly: z.boolean(),
		}),
	),
});

export const UsageDigestPreferenceInputSchema = z.object({
	organizationId: z.string().min(1).max(256),
	kind: UsageDigestKindSchema,
	enabled: z.boolean(),
});

export type UsageDigestPreferences = z.infer<
	typeof UsageDigestPreferencesSchema
>;

export const usageDigestContract = {
	preferences: oc.output(UsageDigestPreferencesSchema),
	setPreference: oc
		.input(UsageDigestPreferenceInputSchema)
		.output(z.object({ success: z.literal(true) })),
};
