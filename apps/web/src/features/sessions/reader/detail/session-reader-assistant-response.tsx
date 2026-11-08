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
				className="ml-0.5 inline-flex align-middle"
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

const REMARK_PLUGINS = [remarkGfm];

export const AssistantResponse = memo(function AssistantResponse({
	text,
}: {
	text: string;
}) {
	return (
		<div className="group/bubble flex items-start justify-between gap-2 px-1">
			<div className="min-w-0 flex-1 text-sm leading-relaxed [overflow-wrap:anywhere] [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.8125rem] [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
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
			<div className="flex flex-col gap-2 px-1 pt-1">
				<Bone className="h-3.5 w-full rounded-sm" />
				<Bone className="h-3.5 w-11/12 rounded-sm" />
				<Bone className="h-3.5 w-2/3 rounded-sm" />
			</div>
		</Bones>
	);
}
