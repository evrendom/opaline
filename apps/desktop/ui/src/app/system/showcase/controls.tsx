import {
	IconAdjustmentsHorizontal,
	IconArrowLeft,
	IconArrowUpRight,
	IconCalendar,
	IconChevronLeft,
	IconChevronRight,
	IconCopy,
	IconExternalLink,
	IconPlus,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Badge } from "@/app/ui/badge";
import { Button } from "@/app/ui/button";
import { Checkbox } from "@/app/ui/checkbox";
import { Field, FieldLabel } from "@/app/ui/field";
import { Input } from "@/app/ui/input";
import { Label } from "@/app/ui/label";
import { Separator } from "@/app/ui/separator";
import { RetryButton } from "@/components/retry-button";
import { Group, Specimen, State } from "./kit";
import { demoPortraits } from "./providers";

/*
 * Button: four variants and nothing else (primary, secondary, danger, link),
 * sizes sm, md (default), lg, icon-sm, icon and inline. `secondary` is the
 * default; `primary` is named on purpose, once per view.
 */
function Buttons() {
	return (
		<>
			<Specimen
				name="Button · primary"
				source="app/ui/button.tsx"
				where="The screen's main action (Save, Connect, Apply, Sign in, Create workspace) and the toolbar's pills (date range, Sorted by, Filter). One main action per view."
			>
				<State label="md">
					<Button variant="primary">Save</Button>
				</State>
				<State label="md, disabled (pending)">
					<Button variant="primary" disabled>
						Create workspace
					</Button>
				</State>
				<State label="sm">
					<Button variant="primary" size="sm">
						View in transcript
					</Button>
				</State>
				<State label="as a link (render)">
					<Button
						variant="primary"
						nativeButton={false}
						render={
							// biome-ignore lint/a11y/useAnchorContent: the Button's children fill the anchor
							<a href="#open-on-github" />
						}
					>
						<IconExternalLink />
						Open on GitHub
					</Button>
				</State>
				<State label="pill, data-active (a range is set)">
					<Button variant="primary" data-active="">
						<IconCalendar />
						Aug 24 - Aug 31, 2026 · Daily
					</Button>
				</State>
				<State label="pill, open (data-popup-open)">
					<Button variant="primary" data-popup-open="">
						<IconAdjustmentsHorizontal />
						Filter
					</Button>
				</State>
				<State label="pill, aria-pressed (focused day)">
					<Button variant="primary" aria-pressed>
						Aug 24
						<IconX />
					</Button>
				</State>
				<State label="icon (pager, enabled side)">
					<Button variant="primary" size="icon" aria-label="Next page">
						<IconChevronRight />
					</Button>
				</State>
			</Specimen>
			<Specimen
				name="Button · secondary (the default)"
				source="app/ui/button.tsx"
				where="Everything that isn't the main action: Cancel, Retry, Copy, row actions, close and remove icons, Raw / Rendered toggles, the calendar's month arrows."
			>
				<State label="md">
					<Button>Cancel</Button>
				</State>
				<State label="md, with icon">
					<Button>
						<IconCopy aria-hidden="true" />
						Copy
					</Button>
				</State>
				<State label="md, disabled">
					<Button disabled>Cancel</Button>
				</State>
				<State label="sm (file change's turn link)">
					<Button size="sm">
						Turn 1ic31r
						<IconArrowUpRight data-icon="inline-end" />
					</Button>
				</State>
				<State label="sm, rest / aria-pressed (Raw · Rendered)">
					<div className="flex gap-xs">
						<Button size="sm" aria-pressed={false}>
							Raw
						</Button>
						<Button size="sm" aria-pressed>
							Rendered
						</Button>
					</div>
				</State>
				<State label="icon">
					<Button size="icon" aria-label="Remove member">
						<IconTrash />
					</Button>
				</State>
				<State label="icon, disabled">
					<Button size="icon" aria-label="Previous page" disabled>
						<IconChevronLeft />
					</Button>
				</State>
			</Specimen>
			<Specimen
				name="Button · danger"
				source="app/ui/button.tsx"
				where="Destructive or hard-to-undo actions only: Delete workspace, Disconnect GitHub, Revoke existing links."
			>
				<State label="md">
					<Button variant="danger">
						<IconTrash />
						Delete workspace
					</Button>
				</State>
				<State label="md, disabled (until confirmed)">
					<Button variant="danger" disabled>
						Revoke existing links
					</Button>
				</State>
			</Specimen>
			<Specimen
				name="Button · link, inline"
				source="app/ui/button.tsx"
				where="An action inside a sentence. Navigation is a <Link>, not a button."
			>
				<State label="link, inline">
					<span className="text-body-xl text-ink-2">
						Could not load repositories.{" "}
						<Button variant="link" size="inline">
							Try again
						</Button>
					</span>
				</State>
			</Specimen>
			<Specimen
				name="RetryButton"
				source="components/retry-button.tsx"
				where="After a load failed: repos, skills, MCP, dashboard chart, session reader, report, GitHub connection."
			>
				<State label="rest">
					<RetryButton onRetry={() => {}} />
				</State>
				<State label="retrying">
					<RetryButton onRetry={() => {}} retrying />
				</State>
			</Specimen>
		</>
	);
}

function PatternButtons() {
	return (
		<>
			<Specimen
				name="text-button"
				source="app/patterns.css"
				where="Compass toolbar (Runs / Patterns tabs, Everyone / Mine, Back), the breakdown sheet's Clear, chart coverage refresh."
			>
				<State label="rest">
					<button type="button" className="text-button">
						Everyone
					</button>
				</State>
				<State label="aria-selected (tab)">
					<button
						type="button"
						role="tab"
						aria-selected
						className="text-button"
					>
						Runs
					</button>
				</State>
				<State label="aria-pressed">
					<button type="button" className="text-button" aria-pressed="true">
						Mine
					</button>
				</State>
				<State label="with icon">
					<button type="button" className="text-button">
						<IconArrowLeft aria-hidden="true" className="size-3.5" />
						Back
					</button>
				</State>
				<State label="disabled">
					<button type="button" className="text-button" disabled>
						<IconRefresh aria-hidden="true" className="size-3.5" />
						Refresh
					</button>
				</State>
			</Specimen>
			<Specimen
				name="secondary-button"
				source="app/patterns.css"
				where="Compass pattern and run detail actions, the breakdown sheet's Apply."
			>
				<State label="rest">
					<button type="button" className="secondary-button">
						Open the session
					</button>
				</State>
			</Specimen>
		</>
	);
}

function Fields() {
	return (
		<>
			<Specimen
				name="Input"
				source="app/ui/input.tsx"
				where="Settings rows (name, email, workspace URL), the invite email, dialogs' confirm field, the filter menu search."
			>
				<State label="value" className="w-56">
					<Input defaultValue="Opaline Demo" />
				</State>
				<State label="placeholder" className="w-56">
					<Input placeholder="teammate@company.com" />
				</State>
				<State label="aria-invalid" className="w-56">
					<Input defaultValue="opaline demo" aria-invalid />
				</State>
				<State label="disabled (saving)" className="w-56">
					<Input defaultValue="Opaline Demo" disabled />
				</State>
			</Specimen>
			<Specimen
				name="Field · FieldLabel"
				source="app/ui/field.tsx"
				where="The type-to-confirm field in Delete workspace and Delete account."
			>
				<Field className="w-80">
					<FieldLabel htmlFor="showcase-confirm">
						Type Opaline Demo to confirm
					</FieldLabel>
					<Input id="showcase-confirm" placeholder="Opaline Demo" />
				</Field>
			</Specimen>
			<Specimen
				name="Checkbox"
				source="app/ui/checkbox.tsx"
				where="Filter menu options, email digest choices, Compass settings, the desktop repository picker."
			>
				<State label="unchecked">
					<Checkbox aria-label="Weekly digest" />
				</State>
				<State label="checked">
					<Checkbox defaultChecked aria-label="Daily digest" />
				</State>
				<State label="disabled, checked">
					<Checkbox defaultChecked disabled aria-label="Always on" />
				</State>
			</Specimen>
			<Specimen
				name="Sign-in form: form-input, form-button, Label, Separator"
				source="app/patterns.css · app/ui/label.tsx · app/ui/separator.tsx"
				where="Sign in, sign up, reset password, self-hosted sign-in and the invitation page."
			>
				<div className="flex w-80 flex-col gap-l">
					<div className="flex flex-col gap-s">
						<Label htmlFor="showcase-email">Email</Label>
						<Input
							id="showcase-email"
							className="form-input"
							placeholder="you@company.com"
						/>
					</div>
					<Button variant="primary" className="form-button">
						Continue
					</Button>
					<div className="flex items-center gap-m">
						<Separator className="flex-1" />
						<span className="text-body-m text-ink-3">or</span>
						<Separator className="flex-1" />
					</div>
					<Button className="form-button" variant="primary">
						Continue with GitHub
					</Button>
					<Button variant="primary" className="form-button" disabled>
						Continue
					</Button>
				</div>
			</Specimen>
		</>
	);
}

function Identity() {
	return (
		<>
			<Specimen
				name="Avatar"
				source="app/ui/avatar.tsx"
				where="Members and breakdown rows, the account row, the workspace mark, session member bubbles. Screens size it with their own class; the primitive's two sizes are these."
			>
				<State label="default, image">
					<Avatar>
						<AvatarImage src={demoPortraits[0]} alt="" />
						<AvatarFallback>E</AvatarFallback>
					</Avatar>
				</State>
				<State label="default, initials">
					<Avatar>
						<AvatarFallback>R</AvatarFallback>
					</Avatar>
				</State>
				<State label="sm, image">
					<Avatar size="sm">
						<AvatarImage src={demoPortraits[0]} alt="" />
						<AvatarFallback>E</AvatarFallback>
					</Avatar>
				</State>
				<State label="sm, initials">
					<Avatar size="sm">
						<AvatarFallback>M</AvatarFallback>
					</Avatar>
				</State>
			</Specimen>
			<Specimen
				name="Badge"
				source="app/ui/badge.tsx"
				where="Only the report page: whether a report is shared."
			>
				<State label="secondary (shared)">
					<Badge variant="secondary">Shared</Badge>
				</State>
				<State label="outline (private)">
					<Badge variant="outline">Private</Badge>
				</State>
			</Specimen>
			<Specimen
				name="Separator · vertical"
				source="app/ui/separator.tsx"
				where="Between the workspace menu and the page title in the shell header (narrow windows)."
			>
				<div className="flex h-6 items-center gap-m text-body-xl">
					<span className="text-ink-3">Workspace</span>
					<Separator
						orientation="vertical"
						className="data-vertical:h-4 data-vertical:self-auto"
					/>
					<span className="text-ink">Dashboard</span>
				</div>
			</Specimen>
		</>
	);
}

export function ControlsGroup() {
	return (
		<Group title="Controls">
			<Buttons />
			<PatternButtons />
			<Fields />
			<Identity />
			<Specimen
				name="Button with an icon"
				source="app/ui/button.tsx"
				where="Icons lead the label at 14px; Invite, Create workspace (link), Delete workspace."
			>
				<State label="default sm + icon">
					<Button variant="primary" size="md">
						<IconPlus data-icon="inline-start" />
						Create workspace
					</Button>
				</State>
			</Specimen>
		</Group>
	);
}
