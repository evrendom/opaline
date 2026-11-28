import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/app/ui/button";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import {
	fetchRetiredCliPresent,
	type RetiredCliRemoval,
	readRetiredCliDismissed,
	removeRetiredCli,
	writeRetiredCliDismissed,
} from "./retired-cli";

const RETIRED_CLI_QUERY_KEY = ["selfhost", "retired-cli"] as const;
const CHECK_INTERVAL_MS = 5 * 60_000;

const BANNER_CLASS =
	"flex items-start gap-m border-b border-warning-line bg-warning-tint px-xl py-m text-body-l text-ink";

/**
 * The retired CLI still tries to upload to Opaline's shut-down cloud. The
 * Mac app's server can remove it; anywhere else the check answers no.
 */
export function RetiredCliBanner() {
	const selfHost = useSelfHost();
	const [dismissed, setDismissed] = useState(readRetiredCliDismissed);
	const [removal, setRemoval] = useState<RetiredCliRemoval | null>(null);
	const queryClient = useQueryClient();
	const { data: present } = useQuery({
		queryKey: RETIRED_CLI_QUERY_KEY,
		queryFn: ({ signal }) => fetchRetiredCliPresent(signal),
		enabled: Boolean(selfHost) && !dismissed,
		refetchInterval: CHECK_INTERVAL_MS,
		refetchOnWindowFocus: false,
		retry: false,
	});
	const remove = useMutation({
		mutationFn: removeRetiredCli,
		onSuccess: (result) => {
			setRemoval(result);
			queryClient.setQueryData(RETIRED_CLI_QUERY_KEY, result.present);
		},
	});

	if (removal)
		return (
			<RetiredCliRemovalView
				removal={removal}
				onClose={() => setRemoval(null)}
			/>
		);
	if (dismissed || present !== true) return null;
	return (
		<section aria-label="Retired Opaline CLI" className={BANNER_CLASS}>
			<IconAlertTriangle
				aria-hidden="true"
				className="mt-s size-4 shrink-0 text-warning"
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-xxs py-xs">
				<p>
					The retired Opaline CLI is still installed on this Mac. It tries to
					send your sessions to Opaline's shut-down cloud, and Opaline does not
					need it.
				</p>
				{remove.error ? (
					<p role="alert" className="text-error">
						{remove.error.message}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-xs">
				<Button
					type="button"
					size="sm"
					disabled={remove.isPending}
					onClick={() => {
						writeRetiredCliDismissed();
						setDismissed(true);
					}}
				>
					Not now
				</Button>
				<Button
					type="button"
					size="sm"
					variant="primary"
					disabled={remove.isPending}
					onClick={() => remove.mutate()}
				>
					{remove.isPending ? "Removing…" : "Remove"}
				</Button>
			</div>
		</section>
	);
}

function RetiredCliRemovalView({
	removal,
	onClose,
}: {
	removal: RetiredCliRemoval;
	onClose: () => void;
}) {
	const title = removal.busy
		? "The retired CLI was busy changing its settings, so only part of it was removed. Try Remove again in a minute."
		: removal.removed.length
			? "Removed the retired Opaline CLI:"
			: "Nothing of the retired Opaline CLI was left to remove.";
	return (
		<section aria-label="Retired Opaline CLI removed" className={BANNER_CLASS}>
			{removal.busy ? (
				<IconAlertTriangle
					aria-hidden="true"
					className="mt-s size-4 shrink-0 text-warning"
				/>
			) : (
				<IconCheck
					aria-hidden="true"
					className="mt-s size-4 shrink-0 text-success"
				/>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-xs py-xs">
				<p>{title}</p>
				{removal.removed.length ? (
					<ul className="list-disc pl-xl">
						{removal.removed.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				) : null}
				{removal.skipped.length ? (
					<>
						<p>Left alone because they could not be read or kept changing:</p>
						<ul className="list-disc pl-xl">
							{removal.skipped.map((line) => (
								<li key={line}>{line}</li>
							))}
						</ul>
					</>
				) : null}
			</div>
			<Button type="button" size="sm" className="shrink-0" onClick={onClose}>
				Close
			</Button>
		</section>
	);
}
