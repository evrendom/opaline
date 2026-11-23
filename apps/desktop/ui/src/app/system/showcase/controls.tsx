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
import { Pressable } from "@/app/ui/pressable";
import { RadioGroup, RadioGroupItem } from "@/app/ui/radio-group";
import { Separator } from "@/app/ui/separator";
import { Textarea } from "@/app/ui/textarea";
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

function Sizes() {
	return (
		<Specimen
			name="Button · sizes"
			source="app/ui/button.tsx"
			where="One vocabulary across the primitives: sm (24px), md (32px, the default), lg (36px, the sign-in forms), icon-sm and icon for icon-only buttons, inline inside a sentence."
		>
			<State label="sm">
				<Button size="sm">Small</Button>
			</State>
			<State label="md (default)">
				<Button>Medium</Button>
			</State>
			<State label="lg">
				<Button variant="primary" size="lg">
					Continue
				</Button>
			</State>
			<State label="icon-sm">
				<Button size="icon-sm" aria-label="Close">
					<IconX />
				</Button>
			</State>
			<State label="icon">
				<Button size="icon" aria-label="Refresh">
					<IconRefresh />
				</Button>
			</State>
			<State label="inline">
				<span className="text-body-xl text-ink-2">
					Nothing yet.{" "}
					<Button variant="link" size="inline">
						Refresh
					</Button>
				</span>
			</State>
		</Specimen>
	);
}

/*
 * Pressable: a whole clickable row, tile, bar, chip or disclosure. Button
 * semantics, the focus mark and the disabled state, and no look of its own:
 * its className is free. Anything shaped like a button is a Button.
 */
function Pressables() {
	return (
		<Specimen
			name="Pressable"
			source="app/ui/pressable.tsx"
			where="Clickable rows, tiles, chart bars, chips and disclosures: the repository picker's rows, the workspace menu, the star card's switch. Tab to one to see the focus mark."
		>
			<State label="row" className="w-72">
				<Pressable className="flex w-full items-center gap-m corner-s px-m py-s text-body-xl hover:bg-hover">
					<IconArrowLeft aria-hidden="true" className="size-3.5 text-ink-3" />
					<span className="flex-1 truncate">opaline/desktop</span>
					<span className="text-body-m text-ink-3">12 sessions</span>
				</Pressable>
			</State>
			<State label="tile" className="w-44">
				<Pressable className="flex w-full flex-col gap-xs corner-m bg-surface p-l shadow-card hover:shadow-raised">
					<span className="text-body-l font-medium">Claude Code</span>
					<span className="text-body-m text-ink-3">418 sessions</span>
				</Pressable>
			</State>
			<State label="disabled" className="w-72">
				<Pressable
					disabled
					className="flex w-full items-center gap-m corner-s px-m py-s text-body-xl"
				>
					<span className="flex-1 truncate">opaline/site</span>
					<span className="text-body-m text-ink-3">Added</span>
				</Pressable>
			</State>
		</Specimen>
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
				name="Textarea"
				source="app/ui/textarea.tsx"
				where="Multi-line text: a report's question, a run question's wording. The same field as Input, growing with its content from three lines."
			>
				<State label="placeholder" className="w-72">
					<Textarea placeholder="Which sessions touched the billing code?" />
				</State>
				<State label="value" className="w-72">
					<Textarea
						defaultValue={
							"Did the agent run the tests\nbefore it said it was done?"
						}
					/>
				</State>
				<State label="disabled" className="w-72">
					<Textarea defaultValue="Saving" disabled />
				</State>
			</Specimen>
			<Specimen
				name="The control field: bg-control · shadow-control"
				source="app/tokens.css · app/ui/input.tsx · app/ui/select.tsx"
				where="Every text field and select stands on the control role: clear on the card's drop in light, a soft tint inside a hairline in dark. The roles flip; no field carries a per-mode class."
			>
				<State label="Input" className="w-56">
					<Input placeholder="Search repositories" />
				</State>
				<State label="Input variant plain (dialogs)" className="w-56">
					<Input variant="plain" placeholder="Opaline Demo" />
				</State>
				<State label="the bare role" className="w-56">
					<div className="h-9 w-full corner-s bg-control shadow-control" />
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
				name="RadioGroup"
				source="app/ui/radio-group.tsx"
				where="Pick one of two to five options that should all stay in view."
			>
				<State label="vertical">
					<RadioGroup defaultValue="weekly" aria-label="Digest">
						<RadioGroupItem value="daily">Daily</RadioGroupItem>
						<RadioGroupItem value="weekly">Weekly</RadioGroupItem>
						<RadioGroupItem value="never" disabled>
							Never
						</RadioGroupItem>
					</RadioGroup>
				</State>
				<State label="horizontal">
					<RadioGroup
						defaultValue="7d"
						orientation="horizontal"
						aria-label="Range"
					>
						<RadioGroupItem value="7d">7 days</RadioGroupItem>
						<RadioGroupItem value="30d">30 days</RadioGroupItem>
					</RadioGroup>
				</State>
			</Specimen>
			<Specimen
				name="Sign-in form: Input, Button lg, Label, Separator"
				source="app/ui/input.tsx · app/ui/button.tsx · app/ui/label.tsx · app/ui/separator.tsx"
				where="Sign in, sign up, reset password, self-hosted sign-in and the invitation page."
			>
				<div className="flex w-80 flex-col gap-l">
					<div className="flex flex-col gap-s">
						<Label htmlFor="showcase-email">Email</Label>
						<Input id="showcase-email" placeholder="you@company.com" />
					</div>
					<Button variant="primary" size="lg" className="w-full">
						Continue
					</Button>
					<div className="flex items-center gap-m">
						<Separator className="flex-1" />
						<span className="text-body-m text-ink-3">or</span>
						<Separator className="flex-1" />
					</div>
					<Button size="lg" className="w-full">
						Continue with GitHub
					</Button>
					<Button variant="primary" size="lg" className="w-full" disabled>
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
					<Badge>Shared</Badge>
				</State>
				<State label="outline (private)">
					<Badge variant="outline">Private</Badge>
				</State>
				<State label="success · warning · error">
					<div className="flex gap-xs">
						<Badge variant="success">Up to date</Badge>
						<Badge variant="warning">Interrupted</Badge>
						<Badge variant="error">Failed</Badge>
					</div>
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
			<Sizes />
			<Pressables />
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
