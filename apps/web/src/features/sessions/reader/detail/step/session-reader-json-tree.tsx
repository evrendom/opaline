import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const KIND_COLOR = {
	number: "text-[oklch(0.5_0.22_281.458)] dark:text-[oklch(0.76_0.14_281.458)]",
	literal:
		"text-[oklch(0.52_0.24_302.391)] dark:text-[oklch(0.76_0.14_302.391)]",
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
			<span className="text-muted-foreground/50">""</span>
		) : (
			<span className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
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
		<span
			className={cn(
				"text-muted-foreground",
				index && "text-muted-foreground/60",
			)}
		>
			{name}
		</span>
	);
	if (!nested)
		return (
			<>
				{key}
				{isNested(value) ? (
					<span className="text-muted-foreground/50">
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
				className="flex cursor-pointer items-center gap-0.5 text-left hover:text-foreground"
			>
				<IconChevronRight
					aria-hidden="true"
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
						open && "rotate-90",
					)}
				/>
				{key}
			</button>
			<span className="text-muted-foreground/50">
				{open ? null : summary(value)}
			</span>
			{open ? (
				<div className="col-span-2 pl-4">
					<Entries depth={depth + 1} value={value} />
				</div>
			) : null}
		</>
	);
}

function Entries({ depth, value }: { depth: number; value: object }) {
	return (
		<div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3">
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
		<div className="font-mono text-[12px] leading-5">
			<Entries depth={0} value={value} />
		</div>
	);
}
