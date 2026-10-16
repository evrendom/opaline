import { schema, table } from "@chkit/core";
import {
	SESSION_IMAGE_COLUMNS,
	SESSION_IMAGES_COMMENT,
	SESSION_IMAGES_KEY,
} from "../../session-images.js";

/**
 * Images of a session (`src/session-images.ts`): its screenshots and pasted
 * images, one row per image and transcript record that carries it.
 */
export const sessionImagesTable = table({
	database: "rudel",
	name: "session_images",
	engine: "SharedReplacingMergeTree(version)",
	columns: [...SESSION_IMAGE_COLUMNS],
	primaryKey: SESSION_IMAGES_KEY,
	orderBy: SESSION_IMAGES_KEY,
	settings: {
		index_granularity: "1024",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment: SESSION_IMAGES_COMMENT,
});

export default schema(sessionImagesTable);
