import "./session-model-progress-ring.css";

// The existing trace silhouette scaled to the center of its 4px background band.
const MODEL_BAND_PATH =
	"M14 2.08C17.14 2.18 20.16 2.55 22.37 4.45C24.58 6.27 25.96 9.64 26 13.99C25.96 18.35 24.58 21.71 22.37 23.54C20.16 25.44 17.14 25.8 14 25.9C10.86 25.8 7.84 25.44 5.63 23.54C3.43 21.71 2.04 18.35 2 13.99C2.04 9.64 3.43 6.27 5.63 4.45C7.84 2.55 10.86 2.18 14 2.08Z";

export function SessionModelProgressRing({
	progress,
}: {
	progress: number | "loading";
}) {
	return (
		<svg aria-hidden="true" className="size-full" viewBox="0 0 28 28">
			<path
				className={
					progress === "loading"
						? "session-model-progress-ring-loading"
						: undefined
				}
				d={MODEL_BAND_PATH}
				fill="none"
				pathLength={100}
				stroke="currentColor"
				strokeDasharray={
					progress === "loading"
						? "28 72"
						: progress < 100
							? `${progress} 100`
							: undefined
				}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={3}
			/>
		</svg>
	);
}
