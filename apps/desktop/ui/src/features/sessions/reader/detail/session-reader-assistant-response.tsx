import {
	Children,
	type ComponentProps,
	createElement,
	memo,
	type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bone, Bones } from "@/app/ui/bones";
import { SignalText } from "@/components/signal-text";
import { remarkAppLinks } from "@/features/desktop/app-link-markdown";
import { CopyButton } from "@/features/shell/components/copy-button";
import { CiViewLink, GitHubLink } from "../ci/session-reader-ci-link";
import { pullRequestKey, useSessionPlaces } from "../session-places";

function withSignals(children: ReactNode): ReactNode {
	return Children.map(children, (child) =>
		typeof child === "string" ? <SignalText text={child} /> : child,
	);
}

function signalMarked(Tag: SignalTag) {
	return function SignalMarked({
		children,
		node: _node,
		...props
	}: ComponentProps<SignalTag> & { node?: unknown }) {
		return createElement(Tag, props, withSignals(children));
	};
}

type SignalTag =
	| "blockquote"
	| "em"
	| "h1"
	| "h2"
	| "h3"
	| "h4"
	| "li"
	| "p"
	| "strong"
	| "td"
	| "th";

const PULL_REQUEST_URL =
	/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

function AnswerLink({
	children,
	href,
	node: _node,
	...props
}: ComponentProps<"a"> & { node?: unknown }) {
	const places = useSessionPlaces();
	const pull = href?.match(PULL_REQUEST_URL);
	if (!places || !href || !pull?.[1] || !pull[2])
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	return (
		<>
			<CiViewLink
				github={href}
				picks={{ pr: pullRequestKey(pull[1], Number(pull[2])) }}
			>
				{children}
			</CiViewLink>
			<GitHubLink
				href={href}
				label="Open on GitHub"
				className="ml-xxs inline-flex align-middle"
			/>
		</>
	);
}

const SIGNAL_MARKDOWN: Components = {
	a: AnswerLink,
	blockquote: signalMarked("blockquote"),
	em: signalMarked("em"),
	h1: signalMarked("h1"),
	h2: signalMarked("h2"),
	h3: signalMarked("h3"),
	h4: signalMarked("h4"),
	li: signalMarked("li"),
	p: signalMarked("p"),
	strong: signalMarked("strong"),
	td: signalMarked("td"),
	th: signalMarked("th"),
};

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks];

export const AssistantResponse = memo(function AssistantResponse({
	text,
}: {
	text: string;
}) {
	return (
		<div className="group/bubble flex items-start justify-between gap-m px-xs">
			<div
				data-selectable=""
				className="min-w-0 flex-1 text-body-xl [overflow-wrap:anywhere] [&_a]:underline [&_code]:corner-xs [&_code]:bg-field [&_code]:px-xs [&_code]:font-mono [&_code]:text-body-l [&_h1]:mt-l [&_h1]:font-heavy [&_h2]:mt-l [&_h2]:font-heavy [&_h3]:mt-l [&_h3]:font-heavy [&_li]:my-xxs [&_ol]:my-s [&_ol]:list-decimal [&_ol]:pl-xl [&_p]:my-s [&_pre]:my-m [&_pre]:overflow-x-auto [&_pre]:corner-s [&_pre]:bg-field [&_pre]:p-l [&_pre_code]:bg-transparent [&_pre_code]:p-zero [&_table]:my-m [&_td]:edge-m [&_td]:px-m [&_td]:py-xs [&_th]:edge-m [&_th]:px-m [&_th]:py-xs [&_ul]:my-s [&_ul]:list-disc [&_ul]:pl-xl [&>*:first-child]:mt-zero [&>*:last-child]:mb-zero"
			>
				<Markdown components={SIGNAL_MARKDOWN} remarkPlugins={REMARK_PLUGINS}>
					{text}
				</Markdown>
			</div>
			<div className="shrink-0 opacity-0 transition-opacity group-hover/bubble:opacity-100">
				<CopyButton value={text} title="Copy response" />
			</div>
		</div>
	);
});

export function AssistantSkeleton() {
	return (
		<Bones label="Reading the response">
			<div className="flex flex-col gap-m px-xs pt-xs">
				<Bone className="h-3.5 w-full corner-xs" />
				<Bone className="h-3.5 w-11/12 corner-xs" />
				<Bone className="h-3.5 w-2/3 corner-xs" />
			</div>
		</Bones>
	);
}
