import type * as React from "react";
import { Card } from "@/app/ui/card";
import "./settings-section.css";

export function SettingsSectionCard({
	size = "sm",
	...props
}: React.ComponentProps<typeof Card>) {
	return <Card size={size} {...props} />;
}
