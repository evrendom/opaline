import { useIsFetching } from "@tanstack/react-query";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { sessionRunAnswersQuery } from "./use-run-question-tags";
import { sessionRunCiQuery } from "./use-session-run-ci";

export function useRunMarksLoading(sessionId: string): boolean {
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const answers = useIsFetching({
		queryKey: sessionRunAnswersQuery(organizationId, sessionId).queryKey,
	});
	const ci = useIsFetching({
		queryKey: sessionRunCiQuery(organizationId, sessionId).queryKey,
	});
	return answers + ci > 0;
}
