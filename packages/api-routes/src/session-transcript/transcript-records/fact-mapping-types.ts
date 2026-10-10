export type MappingRelation =
	| { readonly kind: "unreviewed" | "exact" | "close" | "broader" | "narrower" }
	| { readonly kind: "transform"; readonly transform: string }
	| { readonly kind: "not_emitted" | "not_found" | "provenance" }
	| { readonly kind: "derived"; readonly from: readonly string[] };

export interface FactSourceMapping {
	readonly path: string;
	readonly role: "primary" | "context";
	readonly relation: MappingRelation;
	readonly justification?: string;
}

export type MappingEvidence =
	| {
			readonly kind: "writer_source";
			readonly path: string;
			readonly file: string;
			readonly line: number;
			readonly version: string;
			readonly supportsMeaning: boolean;
			readonly explanation: string;
	  }
	| {
			readonly kind: "published_types";
			readonly path: string;
			readonly reference: string;
			readonly version: string;
			readonly supportsMeaning: boolean;
			readonly explanation: string;
	  }
	| {
			readonly kind: "census";
			readonly path: string;
			readonly count: number;
			readonly corpus: string;
			readonly versions?: readonly string[];
	  }
	| {
			readonly kind: "census";
			readonly search: string;
			readonly corpus: string;
	  }
	| {
			readonly kind: "fixture_test";
			readonly file: string;
			readonly test: string;
	  }
	| {
			readonly kind: "paired_run";
			readonly reference: string;
			readonly scenario: string;
	  }
	| {
			readonly kind: "llm_audit";
			readonly reference: string;
			readonly explanation: string;
	  };

export interface FactMapping {
	readonly relation: MappingRelation;
	readonly sourceMappings?: readonly FactSourceMapping[];
	readonly evidence: readonly MappingEvidence[];
	readonly justification?: string;
	readonly conflict?: string;
}
