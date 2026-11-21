import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const KIND_COLOR = {
	number: "text-warning",
	// design-escape-ok(base): a category colour from the opal sheen (data paint)
	literal: "text-color-3 dark:text-color-2",
} as const;

const OPEN_LEVELS = 2;

const isNested = (value: unknown): value is object =>
	value !== null && typeof value === "object";

const entriesOf = (value: object): [string, unknown][] =>
	Array.isArray(value)
		? value.map((item, index) => [String(index), item])
		: Object.entries(value);

function summary(value: object): string {
	const count = entriesOf(value).length;
	return Array.isArray(value)
		? `[${count} item${count === 1 ? "" : "s"}]`
		: `{${count} key${count === 1 ? "" : "s"}}`;
}

function Primitive({ value }: { value: unknown }) {
	if (typeof value === "string")
		return value === "" ? (
			// design-escape-ok(opacity): no role renders this; text-ink-3/50
			<span className="text-ink-3/50">""</span>
		) : (
			<span className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
				{value}
			</span>
		);
	if (typeof value === "number")
		return <span className={KIND_COLOR.number}>{String(value)}</span>;
	return <span className={KIND_COLOR.literal}>{String(value)}</span>;
}

function Entry({
	depth,
	index,
	name,
	value,
}: {
	depth: number;
	index: boolean;
	name: string;
	value: unknown;
}) {
	const nested = isNested(value) && entriesOf(value).length > 0;
	const [open, setOpen] = useState(depth < OPEN_LEVELS);
	const key = (
		// design-escape-ok(opacity): no role renders this; text-ink-3/60
		<span className={cn("text-ink-3", index && "text-ink-3/60")}>{name}</span>
	);
	if (!nested)
		return (
			<>
				{key}
				{isNested(value) ? (
					// design-escape-ok(opacity): no role renders this; text-ink-3/50
					<span className="text-ink-3/50">
						{Array.isArray(value) ? "[]" : "{}"}
					</span>
				) : (
					<Primitive value={value} />
				)}
			</>
		);
	return (
		<>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className="flex items-center gap-xxs text-left focus-outline hover:text-ink"
			>
				<IconChevronRight
					aria-hidden="true"
					className={cn(
						// design-escape-ok(opacity): no role renders this; text-ink-3/60
						"size-3.5 shrink-0 text-ink-3/60 transition-transform",
						open && "rotate-90",
					)}
				/>
				{key}
			</button>
			{/* design-escape-ok(opacity): no role renders this; text-ink-3/50 */}
			<span className="text-ink-3/50">{open ? null : summary(value)}</span>
			{open ? (
				<div className="col-span-2 pl-xl">
					<Entries depth={depth + 1} value={value} />
				</div>
			) : null}
		</>
	);
}

function Entries({ depth, value }: { depth: number; value: object }) {
	return (
		<div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-l">
			{entriesOf(value).map(([name, item]) => (
				<Entry
					key={name}
					depth={depth}
					index={Array.isArray(value)}
					name={name}
					value={item}
				/>
			))}
		</div>
	);
}

export function JsonTree({ value }: { value: object }) {
	return (
		<div className="font-mono text-body-m">
			<Entries depth={0} value={value} />
		</div>
	);
}
