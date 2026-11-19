import {
	type CompassSettings,
	CompassSettingsSchema,
	withCompassDefaults,
} from "@rudel/api-routes";
import type postgres from "postgres";

/**
 * A workspace's Compass flags (`compass_settings`, migration 0068): each on
 * or off, with its value. No row means every flag on at its default; flags
 * added since a row was saved start on at their defaults. Owners and admins
 * change them; the row goes with the workspace.
 */

export async function readCompassSettings(
	sql: postgres.Sql,
	workspaceId: string,
): Promise<CompassSettings> {
	const [row] = await sql<{ settings: unknown }[]>`
		SELECT settings FROM compass_settings WHERE organization_id = ${workspaceId}
	`;
	return withCompassDefaults(row?.settings);
}

export async function writeCompassSettings(
	sql: postgres.Sql,
	workspaceId: string,
	settings: CompassSettings,
	updatedBy: string,
): Promise<CompassSettings> {
	const stored = withCompassDefaults(CompassSettingsSchema.parse(settings));
	await sql`
		INSERT INTO compass_settings (organization_id, settings, updated_by, updated_at)
		VALUES (${workspaceId}, ${JSON.stringify(stored)}::jsonb, ${updatedBy}, now())
		ON CONFLICT (organization_id) DO UPDATE
		SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()
	`;
	return stored;
}
