import type { SessionReaderTab } from "./reader-params";
import {
	DetailSample,
	PanesSample,
	SummarySample,
} from "./session-reader-light-samples";
import {
	CiColumnsSample,
	FilesColumnsSample,
	SetupColumnsSample,
} from "./session-reader-samples";
import { useReaderPick } from "./session-reader-tabs";

export function ReaderSample({ tab }: { tab: SessionReaderTab }) {
	const { agent, run } = useReaderPick();
	const pick = { agent, model: null, run };
	if (tab === "summary") return <SummarySample />;
	if (tab === "files")
		return (
			<PanesSample>
				<FilesColumnsSample {...pick} />
			</PanesSample>
		);
	if (tab === "setup")
		return (
			<PanesSample>
				<SetupColumnsSample {...pick} />
			</PanesSample>
		);
	if (tab === "ci")
		return (
			<PanesSample>
				<CiColumnsSample {...pick} />
			</PanesSample>
		);
	return <DetailSample />;
}
