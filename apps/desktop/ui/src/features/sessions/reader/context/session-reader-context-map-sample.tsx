import { Bone } from "@/app/ui/bones";
import { cn } from "@/lib/utils";

const MAP_TILES = [
	[0, 0, 19.3, 100],
	[19.8, 0, 21.9, 56.2],
	[19.8, 57.6, 21.9, 42.4],
	[42.2, 0, 12.6, 54],
	[42.2, 55.4, 12.6, 44.6],
	[55.3, 0, 10.8, 49.3],
	[55.3, 50.7, 10.8, 49.3],
	[66.4, 0, 11.5, 44.6],
	[66.4, 46, 10.9, 29.9],
	[66.4, 77.3, 10.9, 22.7],
	[78.4, 0, 10.4, 44.6],
	[89.1, 0, 10.9, 100],
	[77.8, 46, 10.9, 18.6],
	[77.8, 65.9, 6.3, 19.4],
	[84.5, 65.9, 4.2, 19.4],
	[77.8, 86.7, 6.3, 13.3],
	[84.5, 86.7, 4.2, 13.3],
].map(([left, top, width, height]) => ({
	height,
	id: `tile-${left}-${top}`,
	left,
	top,
	width,
}));

export function ContextMapSample({ fill = false }: { fill?: boolean }) {
	return (
		<div className={cn("relative m-[3px]", fill ? "h-full" : "h-[274px]")}>
			{MAP_TILES.map(({ height, id, left, top, width }) => (
				<Bone
					key={id}
					className="absolute rounded-md corner-squircle squircle:rounded-xl"
					style={{
						height: `${height}%`,
						left: `${left}%`,
						top: `${top}%`,
						width: `${width}%`,
					}}
				/>
			))}
		</div>
	);
}
