import type { HistoricalSkillSummary } from "@rudel/api-routes";
import { UsageCollectionView } from "@/components/usage-collection-view";

export function SkillsPageView({
	skills,
	inline = false,
	onSelectSkill,
	...props
}: {
	skills: readonly HistoricalSkillSummary[] | undefined;
	isError: boolean;
	isPending: boolean;
	onRetry: () => void;
	onSelectSkill: (name: string) => void;
	inline?: boolean;
}) {
	return (
		<UsageCollectionView
			{...props}
			inline={inline}
			onSelectItem={onSelectSkill}
			items={skills?.map((skill) => ({
				id: skill.name,
				name: skill.name,
				sessionCount: skill.sessionCount,
				attribution: skill.attribution,
			}))}
		/>
	);
}
