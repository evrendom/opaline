// A Fig completion spec as the command glossary keeps it: the slim form
// scripts/extract-fig-specs.ts writes from @withfig/autocomplete (MIT,
// Hercules Labs Inc.), with only what the argument parser and the
// explanations read. Short keys keep the generated files small.

export type FigArg = {
	n?: string;
	d?: string;
	o?: 1;
	v?: 1;
	c?: 1;
	nb?: 1;
};

export type FigOption = {
	n: string[];
	d?: string;
	a?: FigArg[];
	p?: 1;
	s?: 1;
};

export type FigSpec = {
	n: string[];
	d?: string;
	s?: FigSpec[];
	o?: FigOption[];
	a?: FigArg[];
	pd?: { np?: 1; first?: 1; sep?: string[] };
};
