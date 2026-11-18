export function ContextUtilizationGradients({
	gradientId,
	baselineY,
	topY,
}: {
	gradientId: string;
	baselineY: number;
	topY: number;
}) {
	return (
		<>
			<linearGradient
				id={gradientId}
				gradientUnits="userSpaceOnUse"
				x1="0"
				x2="0"
				y1={baselineY}
				y2={topY}
			>
				<stop
					className="[stop-color:oklch(0.68_0.16_151)] [stop-opacity:0.3] dark:[stop-color:oklch(0.78_0.15_151)] dark:[stop-opacity:0.26]"
					offset="0%"
				/>
				<stop
					className="[stop-color:oklch(0.72_0.16_133)] [stop-opacity:0.34] dark:[stop-color:oklch(0.8_0.15_133)] dark:[stop-opacity:0.3]"
					offset="34%"
				/>
				<stop
					className="[stop-color:oklch(0.79_0.16_91)] [stop-opacity:0.39] dark:[stop-color:oklch(0.83_0.15_91)] dark:[stop-opacity:0.35]"
					offset="61%"
				/>
				<stop
					className="[stop-color:oklch(0.72_0.19_52)] [stop-opacity:0.45] dark:[stop-color:oklch(0.78_0.18_52)] dark:[stop-opacity:0.4]"
					offset="82%"
				/>
				<stop
					className="[stop-color:oklch(0.62_0.23_25)] [stop-opacity:0.52] dark:[stop-color:oklch(0.72_0.21_25)] dark:[stop-opacity:0.46]"
					offset="100%"
				/>
			</linearGradient>
			<linearGradient
				id={`${gradientId}-stroke`}
				gradientUnits="userSpaceOnUse"
				x1="0"
				x2="0"
				y1={baselineY}
				y2={topY}
			>
				<stop
					className="[stop-color:oklch(0.58_0.17_151)] dark:[stop-color:oklch(0.78_0.15_151)]"
					offset="0%"
				/>
				<stop
					className="[stop-color:oklch(0.64_0.17_133)] dark:[stop-color:oklch(0.8_0.15_133)]"
					offset="34%"
				/>
				<stop
					className="[stop-color:oklch(0.7_0.17_91)] dark:[stop-color:oklch(0.83_0.15_91)]"
					offset="61%"
				/>
				<stop
					className="[stop-color:oklch(0.64_0.2_52)] dark:[stop-color:oklch(0.78_0.18_52)]"
					offset="82%"
				/>
				<stop
					className="[stop-color:oklch(0.56_0.24_25)] dark:[stop-color:oklch(0.72_0.21_25)]"
					offset="100%"
				/>
			</linearGradient>
		</>
	);
}
