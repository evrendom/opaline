import { lazy } from "react";
import { useSearchParams } from "react-router-dom";
import { routeLoaders } from "@/app/route-loaders";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { SkillsPageView } from "@/features/skills/components/SkillsPageView";
import { orpc } from "@/lib/orpc";

const WorkspaceSetupPage = lazy(() =>
	routeLoaders.workspaceSetup().then((module) => ({
		default: module.WorkspaceSetupPage,
	})),
);
const SkillDetailPage = lazy(() =>
	routeLoaders.skillDetail().then((module) => ({
		default: module.SkillDetailPage,
	})),
);

const PICK_PARAMS = [
	"session",
	"turn",
	"view",
	"setup",
	"pickedRun",
	"pickedCall",
];

export function SkillsPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const selectedSkillName = searchParams.get("skill");
	function setSelectedSkillName(name: string | null) {
		const next = new URLSearchParams(searchParams);
		for (const key of PICK_PARAMS) next.delete(key);
		if (name) next.set("skill", name);
		else next.delete("skill");
		setSearchParams(next);
	}
	const skillsQuery = useAnalyticsQuery(
		orpc.analytics.skills.list.queryOptions({}),
	);
	const selectedSkill = skillsQuery.data?.find(
		(skill) => skill.name === selectedSkillName,
	);

	if (selectedSkillName && !searchParams.get("session")) {
		return (
			<WorkspaceSetupPage
				name={selectedSkillName}
				onBackToList={() => setSelectedSkillName(null)}
				section="skills"
			/>
		);
	}
	if (selectedSkillName) {
		return (
			<SkillDetailPage
				name={selectedSkillName}
				previewContent={selectedSkill?.contentPreview ?? null}
				onBack={() => setSelectedSkillName(null)}
			/>
		);
	}
	return (
		<SkillsPageView
			skills={skillsQuery.data}
			isError={skillsQuery.isError}
			isPending={skillsQuery.isPending}
			onRetry={() => {
				void skillsQuery.refetch();
			}}
			onSelectSkill={setSelectedSkillName}
		/>
	);
}
