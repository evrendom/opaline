import { useSearchParams } from "react-router-dom";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { SkillPage } from "@/features/repos/repo-skill-page";
import { SkillsPageView } from "@/features/skills/components/SkillsPageView";
import { SkillDetailPage } from "@/features/skills/skill-detail-page";
import { orpc } from "@/lib/orpc";

export function SkillsPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const selectedSkillName = searchParams.get("skill");
	function setSelectedSkillName(name: string | null) {
		const next = new URLSearchParams(searchParams);
		next.delete("session");
		next.delete("turn");
		next.delete("view");
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

	// A link from inside a session (`?session=`) opens the skill beside that
	// session; otherwise the skill's page across every repo, as a repo's
	// skill page shows it within one.
	if (selectedSkillName && !searchParams.get("session")) {
		return (
			<SkillPage
				key={selectedSkillName}
				skillName={selectedSkillName}
				onBackToList={() => setSelectedSkillName(null)}
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
