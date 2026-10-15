import {
	COMPASS_FLAGS,
	type CompassSettings,
	type MomentKind,
} from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/ui/button";
import { Checkbox } from "@/app/ui/checkbox";
import { Input } from "@/app/ui/input";
import { Skeleton } from "@/app/ui/skeleton";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { client, orpc } from "@/lib/orpc";
import { MOMENT_KINDS_APPEARANCE } from "./moment-labels";

/**
 * Settings › Compass: which flags make a run noticeable, each on or off,
 * with its value. Owners and admins change them for the whole workspace;
 * members see them.
 */
export function CompassSettingsPage() {
	const queryClient = useQueryClient();
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const options = orpc.analytics.moments.settings.queryOptions();
	const query = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: !!organizationId,
	});
	const [draft, setDraft] = useState<CompassSettings | null>(null);
	const [saving, setSaving] = useState(false);
	const settings = draft ?? query.data?.settings ?? null;
	const canEdit = query.data?.canEdit === true;
	const changed =
		draft !== null &&
		JSON.stringify(draft) !== JSON.stringify(query.data?.settings);

	const update = (
		kind: MomentKind,
		next: Partial<CompassSettings["flags"][MomentKind]>,
	) =>
		setDraft((current) => {
			const base = current ?? query.data?.settings;
			if (!base) return current;
			return {
				flags: { ...base.flags, [kind]: { ...base.flags[kind], ...next } },
			};
		});

	async function save() {
		if (!draft) return;
		setSaving(true);
		try {
			await client.analytics.moments.updateSettings(draft);
			await queryClient.invalidateQueries({
				predicate: (cached) =>
					JSON.stringify(cached.queryKey).includes('"moments"'),
			});
			setDraft(null);
			toast.success("Compass settings saved");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not save. Try again.",
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="workspace-settings-page">
			<WorkspaceSettingsGroup
				title="Flags"
				description={
					canEdit
						? "A run shows on Compass when one of these flags marks it. Turn a flag off, or change the value it fires at, for the whole workspace."
						: "A run shows on Compass when one of these flags marks it. Owners and admins can change them."
				}
			>
				{query.isPending || !settings ? (
					COMPASS_FLAGS.slice(0, 5).map((flag) => (
						<WorkspaceSettingsRow key={flag.kind} label={flag.label}>
							<Skeleton className="h-4 w-36" />
						</WorkspaceSettingsRow>
					))
				) : query.isError ? (
					<WorkspaceSettingsRow label="Could not load Compass settings.">
						<button
							type="button"
							className="text-sm underline"
							onClick={() => void query.refetch()}
						>
							Try again
						</button>
					</WorkspaceSettingsRow>
				) : (
					COMPASS_FLAGS.map((flag) => (
						<FlagRow
							key={flag.kind}
							flag={flag}
							setting={settings.flags[flag.kind]}
							canEdit={canEdit}
							frustrationCheck={query.data?.frustrationCheck === true}
							onChange={(next) => update(flag.kind, next)}
						/>
					))
				)}
			</WorkspaceSettingsGroup>
			{canEdit ? (
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						disabled={!changed || saving}
						onClick={() => setDraft(null)}
					>
						Discard
					</Button>
					<Button
						type="button"
						disabled={!changed || saving}
						onClick={() => void save()}
					>
						{saving ? "Saving…" : "Save changes"}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function FlagRow({
	flag,
	setting,
	canEdit,
	frustrationCheck,
	onChange,
}: {
	flag: (typeof COMPASS_FLAGS)[number];
	setting: CompassSettings["flags"][MomentKind];
	canEdit: boolean;
	frustrationCheck: boolean;
	onChange: (next: Partial<CompassSettings["flags"][MomentKind]>) => void;
}) {
	const checkboxId = useId();
	const inputId = useId();
	const appearance = MOMENT_KINDS_APPEARANCE[flag.kind];
	const Glyph = appearance.icon;
	const description =
		flag.kind === "user_frustrated" && !frustrationCheck
			? `${flag.description} The SubQ check is off for this workspace, so only the negative words count.`
			: flag.description;
	return (
		<WorkspaceSettingsRow
			label={
				<span className="flex items-center gap-2">
					<Checkbox
						id={checkboxId}
						checked={setting.enabled}
						disabled={!canEdit}
						onCheckedChange={(checked) => onChange({ enabled: checked })}
						aria-label={`${flag.label} on`}
					/>
					<Glyph
						aria-hidden="true"
						className="size-3.5 shrink-0"
						style={{ color: appearance.color } as CSSProperties}
					/>
					<label htmlFor={checkboxId} className="cursor-pointer">
						{flag.label}
					</label>
				</span>
			}
			description={description}
		>
			{flag.value ? (
				<span className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
					<label htmlFor={inputId} className="whitespace-nowrap">
						{flag.value.label}
					</label>
					<Input
						id={inputId}
						type="number"
						inputMode="numeric"
						min={flag.value.min}
						max={flag.value.max}
						step={1}
						value={setting.value ?? flag.value.defaultValue}
						disabled={!canEdit || !setting.enabled}
						onChange={(event) => {
							const value = Number.parseInt(event.target.value, 10);
							if (!Number.isNaN(value))
								onChange({
									value: Math.min(
										flag.value?.max ?? value,
										Math.max(flag.value?.min ?? value, value),
									),
								});
						}}
						className="w-20 text-right tabular-nums"
					/>
					<span className="whitespace-nowrap">{flag.value.unit}</span>
				</span>
			) : (
				<span className="text-sm text-muted-foreground">On or off</span>
			)}
		</WorkspaceSettingsRow>
	);
}
