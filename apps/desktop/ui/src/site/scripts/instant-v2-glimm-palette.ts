import { ACCENTS, accentChain } from "glimm";

export const INSTANT_V2_GLIMM_PALETTE = accentChain([
	ACCENTS.blue,
	ACCENTS.indigo,
	ACCENTS.purple,
	ACCENTS.pink,
]);

export const PERSONAL_GLIMM_PALETTE = accentChain([
	ACCENTS.mint,
	ACCENTS.teal,
	ACCENTS.cyan,
	ACCENTS.blue,
]);

export const PENDING_GLIMM_PALETTE = accentChain([
	"#FFE876",
	ACCENTS.yellow,
	"#FFBE38",
	"#FFF2A3",
]);

export const INTERRUPTED_GLIMM_PALETTE = accentChain([
	"#FF4938",
	"#F45C3C",
	ACCENTS.orange,
	"#FF6350",
]);
