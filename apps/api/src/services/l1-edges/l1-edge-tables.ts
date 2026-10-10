/** L1 edge tables (docs/adr/0003-l1-evidence-entities-edges.md). */
export const L1_EDGES_TABLE = "rudel.l1_edges";
/** Copy of the edges ordered by target; a delete on L1_EDGES_TABLE does not reach it. */
export const L1_EDGES_BY_TARGET_TABLE = "rudel.l1_edges_by_target";
export const L1_EDGE_RESOLUTIONS_TABLE = "rudel.l1_edge_resolutions";
export const L1_EDGE_TABLES = [
	L1_EDGES_TABLE,
	L1_EDGES_BY_TARGET_TABLE,
	L1_EDGE_RESOLUTIONS_TABLE,
] as const;
/**
 * The L1 run index (docs/l1-literal-schema.md, "Scale"): runs per committed
 * transcript generation, written by the same worker and purged with the
 * session's other derived rows.
 */
export const RUN_INDEX_TABLE = "rudel.run_index";
