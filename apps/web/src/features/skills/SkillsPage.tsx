import { useSearchParams } from "react-router-dom";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
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
