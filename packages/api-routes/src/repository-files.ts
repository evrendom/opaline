import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	RepositoryFileInputSchema,
	RepositoryFileSchema,
	RepositoryFilesSchema,
	RepositoryInputSchema,
	RepositoryRangedInputSchema,
} from "./schemas/repositories.js";

export const REPOSITORY_FILE_ACTIVITY_LIMIT = 5000;

export const RepositoryFileActivityPathSchema = z.object({
	path: z.string(),
	reads: z.number().int().nonnegative(),
	changes: z.number().int().nonnegative(),
	sessions: z.number().int().nonnegative(),
	added: z.boolean(),
	lastAt: z.string(),
});

export const RepositoryFileActivitySchema = z.object({
	paths: z
		.array(RepositoryFileActivityPathSchema)
		.max(REPOSITORY_FILE_ACTIVITY_LIMIT),
	truncated: z.boolean(),
});

export const repositoryFilesContract = {
	files: oc.input(RepositoryInputSchema).output(RepositoryFilesSchema),
	file: oc.input(RepositoryFileInputSchema).output(RepositoryFileSchema),
	fileActivity: oc
		.input(RepositoryRangedInputSchema)
		.output(RepositoryFileActivitySchema),
};

export type RepositoryFileActivityPath = z.infer<
	typeof RepositoryFileActivityPathSchema
>;
export type RepositoryFileActivity = z.infer<
	typeof RepositoryFileActivitySchema
>;
