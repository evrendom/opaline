import {
	COMPASS_FLAGS,
	type CompassSettings,
	type MomentKind,
} from "@rudel/api-routes";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useId, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/app/ui/checkbox";
import { Input } from "@/app/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/ui/popover";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { client, orpc } from "@/lib/orpc";
import { MOMENT_KINDS_APPEARANCE } from "./moment-labels";
import { useCompassEnabled } from "./use-compass-access";

type FlagSetting = CompassSettings["flags"][MomentKind];

/**
 * What Compass catches, next to the list it changes: each flag on or off
 * with the value it fires at, for the whole workspace. Owners and admins
 * change them and every change saves at once; members see them.
 */
export function CompassSettingsButton() {
	const queryClient = useQueryClient();
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const allowed = useCompassEnabled();
	const options = orpc.analytics.moments.settings.queryOptions();
	const queryKey = ["org", organizationId, ...options.queryKey];
	const query = useQuery({
		...options,
		queryKey,
		enabled: allowed && !!organizationId,
	});
	const canEdit = query.data?.canEdit === true;

	async function change(kind: MomentKind, next: Partial<FlagSetting>) {
		const view = query.data;
		if (!view) return;
		const settings: CompassSettings = {
			flags: {
				...view.settings.flags,
				[kind]: { ...view.settings.flags[kind], ...next },
			},
		};
		queryClient.setQueryData(queryKey, { ...view, settings });
		try {
			await client.analytics.moments.updateSettings(settings);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not save. Try again.",
			);
		}
		await queryClient.invalidateQueries({
			predicate: (cached) =>
				JSON.stringify(cached.queryKey).includes('"moments"'),
		});
	}

	return (
		<Popover>
			<PopoverTrigger
				className="text-button compass-icon-button"
				aria-label="What Compass catches"
				title="What Compass catches"
			>
				<IconAdjustmentsHorizontal aria-hidden="true" className="size-4" />
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={6} className="w-[23rem]">
				<div className="flex flex-col gap-m">
					<div className="compass-settings-heading">
						<span className="font-medium">What Compass catches</span>
						<span className="compass-hint">
							{canEdit
								? "A run shows when one of these flags marks it. Changes apply to the whole workspace."
								: "A run shows when one of these flags marks it. Owners and admins can change them."}
						</span>
					</div>
					<div className="compass-settings-list">
						{query.data ? (
							COMPASS_FLAGS.map((flag) => (
								<FlagSettingRow
									key={flag.kind}
									flag={flag}
									setting={query.data.settings.flags[flag.kind]}
									canEdit={canEdit}
									frustrationCheck={query.data.frustrationCheck}
									onChange={(next) => void change(flag.kind, next)}
								/>
							))
						) : query.isError ? (
							<p className="compass-hint px-m py-l">
								Could not load the settings.
							</p>
						) : (
							<p className="compass-hint px-m py-l">Loading…</p>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function FlagSettingRow({
	flag,
	setting,
	canEdit,
	frustrationCheck,
	onChange,
}: {
	flag: (typeof COMPASS_FLAGS)[number];
	setting: FlagSetting;
	canEdit: boolean;
	frustrationCheck: boolean;
	onChange: (next: Partial<FlagSetting>) => void;
}) {
	const checkboxId = useId();
	const appearance = MOMENT_KINDS_APPEARANCE[flag.kind];
	const Glyph = appearance.icon;
	const description =
		flag.kind === "user_frustrated" && !frustrationCheck
			? `${flag.description} The SubQ check is off for this workspace, so only the negative words count.`
			: flag.description;
	return (
		<div className="compass-settings-row" title={description}>
			<Checkbox
				id={checkboxId}
				checked={setting.enabled}
				disabled={!canEdit}
				onCheckedChange={(checked) => onChange({ enabled: checked })}
			/>
			<Glyph
				aria-hidden="true"
				className="compass-row-glyph"
				style={{ "--glyph-color": appearance.color } as CSSProperties}
			/>
			<label htmlFor={checkboxId} className="compass-settings-label">
				{flag.label}
			</label>
			{flag.value ? (
				<FlagValueInput
					key={setting.value ?? flag.value.defaultValue}
					value={setting.value ?? flag.value.defaultValue}
					bounds={flag.value}
					disabled={!canEdit || !setting.enabled}
					onCommit={(value) => onChange({ value })}
				/>
			) : null}
		</div>
	);
}

/** A flag's value, saved when the field is left or Enter is pressed. */
function FlagValueInput({
	value,
	bounds,
	disabled,
	onCommit,
}: {
	value: number;
	bounds: NonNullable<(typeof COMPASS_FLAGS)[number]["value"]>;
	disabled: boolean;
	onCommit: (value: number) => void;
}) {
	const [draft, setDraft] = useState(String(value));
	const commit = () => {
		const parsed = Number.parseInt(draft, 10);
		if (Number.isNaN(parsed)) {
			setDraft(String(value));
			return;
		}
		const next = Math.min(bounds.max, Math.max(bounds.min, parsed));
		setDraft(String(next));
		if (next !== value) onCommit(next);
	};
	return (
		<span className="compass-settings-value">
			<Input
				type="number"
				inputMode="numeric"
				min={bounds.min}
				max={bounds.max}
				step={1}
				value={draft}
				disabled={disabled}
				aria-label={bounds.label}
				className="w-16"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
			/>
			<span>{bounds.unit}</span>
		</span>
	);
}
