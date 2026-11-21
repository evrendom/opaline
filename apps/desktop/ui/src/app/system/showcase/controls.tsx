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
 * Button variant × size × state, only as the reachable code passes them
 * (components/screens' <Button …> and buttonVariants(…) calls). Sizes the app
 * never passes to a variant are not shown.
 */
function Buttons() {
	return (
		<>
			<Specimen
				name="Button · default"
				source="app/ui/button.tsx"
				where="Primary actions: Invite, Create workspace, Apply in the date picker, Go to dashboard (404), sign-in forms."
			>
				<State label="default">
					<Button>Go to dashboard</Button>
				</State>
				<State label="sm">
					<Button size="sm">Invite</Button>
				</State>
				<State label="sm, disabled (pending)">
					<Button size="sm" disabled>
						Create workspace
					</Button>
				</State>
				<State label="xs">
					<Button size="xs">View in transcript</Button>
				</State>
				<State label="xs, disabled (link pending)">
					<Button size="xs" disabled>
						Copy
					</Button>
				</State>
				<State label="xs, aria-pressed (admin verdict)">
					<Button size="xs" aria-pressed>
						Yes
					</Button>
				</State>
				<State label="disabled">
					<Button disabled>Continue</Button>
				</State>
			</Specimen>
			<Specimen
				name="Button · outline"
				source="app/ui/button.tsx"
				where="Secondary actions: Cancel in dialogs, Manage on GitHub, Reconnect, Open dashboard, Create invite link, Refresh."
			>
				<State label="default">
					<Button variant="outline">Cancel</Button>
				</State>
				<State label="sm">
					<Button variant="outline" size="sm">
						Reconnect
					</Button>
				</State>
				<State label="sm, disabled">
					<Button variant="outline" size="sm" disabled>
						Create invite link
					</Button>
				</State>
				<State label="as a link (render)">
					<Button
						variant="outline"
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
				<State label="icon-sm (pager, enabled side)">
					<Button variant="outline" size="icon-sm" aria-label="Next page">
						<IconChevronRight />
					</Button>
				</State>
			</Specimen>
			<Specimen
				name="Button · ghost"
				source="app/ui/button.tsx"
				where="Quiet actions: dialog and sheet close, member remove, the pager's end side, Raw / Rendered and version toggles, Retry, Copy, Cancel."
			>
				<State label="sm">
					<Button variant="ghost" size="sm">
						Retry
					</Button>
				</State>
				<State label="sm, with icon">
					<Button variant="ghost" size="sm">
						<IconCopy aria-hidden="true" />
						Copy
					</Button>
				</State>
				<State label="sm, disabled">
					<Button variant="ghost" size="sm" disabled>
						Cancel
					</Button>
				</State>
				<State label="xs (file change's turn link)">
					<Button variant="ghost" size="xs">
						Turn 1ic31r
						<IconArrowUpRight data-icon="inline-end" />
					</Button>
				</State>
				<State label="xs, rest / aria-pressed (Raw · Rendered)">
					<div className="flex gap-xs">
						<Button variant="ghost" size="xs" aria-pressed={false}>
							Raw
						</Button>
						<Button variant="ghost" size="xs" aria-pressed>
							Rendered
						</Button>
					</div>
				</State>
				<State label="icon-sm">
					<Button variant="ghost" size="icon-sm" aria-label="Remove member">
						<IconTrash />
					</Button>
				</State>
				<State label="icon-sm, disabled">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Previous page"
						disabled
					>
						<IconChevronLeft />
					</Button>
				</State>
				<State label="icon (calendar month)">
					<Button variant="ghost" size="icon" aria-label="Previous month">
						<IconChevronLeft />
					</Button>
				</State>
				<State label="disabled">
					<Button variant="ghost" disabled>
						Cancel
					</Button>
				</State>
			</Specimen>
			<Specimen
				name="Button · destructive"
				source="app/ui/button.tsx"
				where="Delete workspace, Disconnect GitHub, Revoke existing links, Delete account."
			>
				<State label="default">
					<Button variant="destructive">Delete workspace</Button>
				</State>
				<State label="default, disabled (until confirmed)">
					<Button variant="destructive" disabled>
						Delete workspace
					</Button>
				</State>
				<State label="sm">
					<Button variant="destructive" size="sm">
						<IconTrash />
						Delete workspace
					</Button>
				</State>
				<State label="sm, disabled">
					<Button variant="destructive" size="sm" disabled>
						Revoke existing links
					</Button>
				</State>
			</Specimen>
			<Specimen
				name="Button · link, inline"
				source="app/ui/button.tsx"
				where="A retry inside a sentence: sessions settings repositories, email digests, the desktop repository picker."
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
				<State label="rest (outline, sm)">
					<RetryButton onRetry={() => {}} />
				</State>
				<State label="retrying">
					<RetryButton onRetry={() => {}} retrying />
				</State>
			</Specimen>
			<Specimen
				name="Button · toolbar"
				source="app/ui/button.tsx"
				where="The page toolbar's pills: date range, Sorted by, Filter, the focused-day tag, invite link actions."
			>
				<State label="rest">
					<Button variant="toolbar">
						<IconCalendar />
						Aug 24 - Aug 31, 2026 · Daily
					</Button>
				</State>
				<State label="data-active (a range is set)">
					<Button variant="toolbar" data-active="">
						<IconCalendar />
						Aug 24 - Aug 31, 2026 · Daily
					</Button>
				</State>
				<State label="open (data-popup-open)">
					<Button variant="toolbar" data-popup-open="">
						<IconAdjustmentsHorizontal />
						Filter
					</Button>
				</State>
				<State label="aria-pressed (focused day)">
					<Button variant="toolbar" aria-pressed>
						Aug 24
						<IconX />
					</Button>
				</State>
				<State label="disabled">
					<Button variant="toolbar" disabled>
						Copy
					</Button>
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
					<Button className="form-button">Continue</Button>
					<div className="flex items-center gap-m">
						<Separator className="flex-1" />
						<span className="text-body-m text-ink-3">or</span>
						<Separator className="flex-1" />
					</div>
					<Button className="form-button" variant="outline">
						Continue with GitHub
					</Button>
					<Button className="form-button" disabled>
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
					<Button size="sm">
						<IconPlus data-icon="inline-start" />
						Create workspace
					</Button>
				</State>
			</Specimen>
		</Group>
	);
}
