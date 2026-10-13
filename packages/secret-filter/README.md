# @rudel/secret-filter

Deterministic redaction of known secret patterns in Opaline session transcripts.
The runtime package has no dependencies.

The generated rules are sourced from the high-confidence, prefixed rules in
[Gitleaks v8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1),
plus local overrides and local rules for transcript shapes Gitleaks does not
cover (AWS secret access keys by name or next to their id, current OpenAI and
Anthropic key formats, JWTs, private keys split across JSON strings,
connection-string passwords and `Authorization` header values). The exact
upstream TOML checksum, the selected rule IDs, the local rules and their order
live in `scripts/ruleset-config.ts`. Run `bun run update:gitleaks` from this
package to verify the pin, refresh the vendored TOML subset, and regenerate the
TypeScript module (`bun run generate` regenerates without downloading).

Transcripts are JSON, so the generated rules are escape-aware: a secret after
an escaped line break or before an escaped quote matches at any nesting depth,
and `\uXXXX`-escaped ASCII and `\/` are decoded for matching (a redaction
removes whole escape sequences, so JSON stays valid). Every rule has keywords;
text containing none of them skips the rule.

This filter intentionally does not use entropy or generic-token heuristics to
mutate transcripts. It favors precision over recall. The CLI
(`opalinehq/cli`) runs a byte-identical copy, so regexes must behave the same
in Bun and Node (no back-references inside lookarounds).

Matched values are removed in full, including matches larger than 8 KiB. Those
large matches receive an `overlong-match` diagnostic, and their complete UTF-8
size counts toward the upload's 20% redaction safety budget. Filtering is
bounded to four changing passes plus a clean confirmation; an upload is
rejected if the filter cannot establish a fixpoint without another change.
