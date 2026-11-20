import { CostDashboardView } from "@/features/costs/cost-dashboard-page";
import { useAdminCostDashboard } from "@/features/costs/use-cost-dashboard";

// Operator-only, anonymous view across every user. It deliberately sits
// outside the app shell: no sessions, repositories, or skills navigation, and
// no member or repository breakdowns. The API enforces admin-organization
// membership and never returns user or repository identities here.
export function AdminDashboardPage() {
	const dashboard = useAdminCostDashboard();
	return (
		<main className="dashboard-01-theme flex h-dvh flex-col">
			<CostDashboardView
				dashboard={dashboard}
				toolbarStart={
					<h1 className="flex h-7 shrink-0 items-center px-s text-body-xl font-medium text-ink">
						All users
					</h1>
				}
			/>
		</main>
	);
}
