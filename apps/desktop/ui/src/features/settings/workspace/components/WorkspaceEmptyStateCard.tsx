import { IconPlus } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/app/ui/button";
import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/ui/card";
import { SettingsSectionCard } from "@/features/settings/components/settings-section";

export function WorkspaceEmptyStateCard() {
	return (
		<SettingsSectionCard>
			<CardHeader className="gap-s group-data-[size=sm]/card:px-xl">
				<CardTitle className="group-data-[size=sm]/card:text-body-xxl">
					No workspace selected
				</CardTitle>
				<CardDescription>
					You can create a workspace here or accept an invitation to join one
					that already exists.
				</CardDescription>
			</CardHeader>
			<CardContent className="group-data-[size=sm]/card:px-xl">
				<Link to="#new-workspace" className={buttonVariants({ size: "sm" })}>
					<IconPlus data-icon="inline-start" />
					Create workspace
				</Link>
			</CardContent>
		</SettingsSectionCard>
	);
}
