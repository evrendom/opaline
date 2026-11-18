import type { DemoRunCiSession } from "./demo-run-ci-builders.js";
import {
	BOTH,
	ci,
	LOOMRAIL,
	LOOMRAIL_UI,
	linked,
	merged,
	preview,
	pullCi,
	sessionRun,
} from "./demo-run-ci-builders.js";

const SLOTS = "fix/slot-timezones";
const SLOTS_FORMAT_RED = pullCi(
	LOOMRAIL,
	"16747687841",
	SLOTS,
	"0d8b99611c2840fe9426fdf54a25d4b33d23853d",
	"2026-08-20T07:41:52Z",
	["16747687848", "failure", 337],
	1000000528,
);
const SLOTS_FORMATTED = "66a7998f502bbbc4a0f896bdb9f80387909e99b6";
const SLOTS_TEAMMATE_RED = pullCi(
	LOOMRAIL,
	"16723432273",
	SLOTS,
	"d5bf124109dd18bca355f502e74ce3214f453ff8",
	"2026-08-20T08:27:41Z",
	["16723432280", "failure", 356],
	1000000644,
);
const SLOTS_MODULE_RED = "ab3b9c7a1c9718b6260b14fafb51205f2eda6072";
const SLOTS_DOCUMENTED = "7244c44e8240ba0117985a14dee8b4a3f0fe35e8";

const MODAL = "fix/modal-a11y";
const MODAL_PUSHED = "7fb97fce08a81f2b367fd093804a09d42eff0fae";

const CANCELLED_AT = "feat/booking-cancelled-at";
const CANCELLED_AT_RED = pullCi(
	LOOMRAIL,
	"16503740560",
	CANCELLED_AT,
	"c526dc6edf1433e8c1bb3a7a19e6071f48c8d929",
	"2026-08-27T04:01:46Z",
	["16503740567", "failure", 117],
	1000000473,
);
const CANCELLED_AT_GREEN = "28388d52ad061a33c2f83c20e118f62c1b5145c3";

const DIALOG = "fix/dialog-focus-return";
const DIALOG_PUSHED = "5a4143d6042f7980fc2f0b39b79db1452dee2a3d";
const DIALOG_DOCUMENTED = "c01c8b65ed48ff45dfb008a19a90638a66d37f96";

export const DEMO_RUN_CI: Readonly<Record<string, DemoRunCiSession>> = {
	"371ba02e-5a6e-4c0c-9aff-45ecf70972ae": {
		runs: [
			sessionRun(1, "2026-08-20T07:58:57.776Z", [
				linked(SLOTS_FORMAT_RED, "exact", ["ci_named"], [412]),
				...[
					pullCi(
						LOOMRAIL,
						"16748013517",
						SLOTS,
						SLOTS_FORMATTED,
						"2026-08-20T08:00:31Z",
						["16748013524", "success", 317],
						1000000611,
					),
					preview(
						LOOMRAIL,
						"16748013519",
						SLOTS,
						SLOTS_FORMATTED,
						"2026-08-20T08:00:31Z",
						["16748013531", null],
						null,
					),
				].map((run) => linked(run, "exact", ["commit_pushed"], [412])),
			]),
			sessionRun(4, "2026-08-20T08:41:12.856Z", [
				linked(SLOTS_TEAMMATE_RED, "exact", ["ci_named"], [412]),
				...[
					pullCi(
						LOOMRAIL,
						"16752200984",
						SLOTS,
						SLOTS_MODULE_RED,
						"2026-08-20T08:42:37Z",
						["16752200991", "failure", 331],
						1000000586,
					),
					preview(
						LOOMRAIL,
						"16752200987",
						SLOTS,
						SLOTS_MODULE_RED,
						"2026-08-20T08:42:37Z",
						["16752200998", null],
						null,
					),
				].map((run) => linked(run, "exact", ["commit_pushed"], [412])),
			]),
			sessionRun(
				6,
				"2026-08-20T09:34:54.102Z",
				[
					pullCi(
						LOOMRAIL,
						"16756912070",
						SLOTS,
						SLOTS_DOCUMENTED,
						"2026-08-20T09:35:59Z",
						["16756912077", "success", 318],
						1000000459,
					),
					preview(
						LOOMRAIL,
						"16756912072",
						SLOTS,
						SLOTS_DOCUMENTED,
						"2026-08-20T09:35:59Z",
						["16756912085", null],
						null,
					),
				].map((run) => linked(run, "pr_window", ["pr_branch_head"], [412])),
			),
		],
		pullRequests: [
			merged(
				LOOMRAIL,
				412,
				"Fix booking slots shifting by an hour",
				SLOTS,
				"marc-acme",
				"2026-08-21T16:12:09Z",
			),
		],
	},
	"7191beb7-5229-464d-8d4d-61956689f9a2": {
		runs: [
			sessionRun(1, "2026-08-28T08:14:44.333Z", [
				...[
					...[
						[1, "16453195209", [0, 4, 329], 1000000532],
						[2, "16453195213", [666, 670, 1047], 1000000608],
					].map(([attempt, jobId, seconds, runner]) =>
						ci({
							repository: LOOMRAIL,
							runId: "16453195206",
							attempt: attempt as number,
							workflow: "ci",
							event: "pull_request",
							branch: MODAL,
							sha: "cc798427988003528d167257fc09e1ae250331f7",
							conclusion: "failure",
							createdAt: "2026-08-28T07:39:52Z",
							jobs: [
								[
									jobId as string,
									"check",
									"failure",
									seconds as [number, number, number],
									runner as number,
								],
							],
						}),
					),
					preview(
						LOOMRAIL,
						"17963021240",
						MODAL,
						MODAL_PUSHED,
						"2026-08-28T08:20:45Z",
						["17963021243", 151],
						1000000497,
					),
					preview(
						LOOMRAIL,
						"17740362515",
						MODAL,
						MODAL_PUSHED,
						"2026-08-28T09:41:25Z",
						["17740362518", 138],
						1000000620,
					),
				].map((run) => linked(run, "exact", ["ci_named"], [433])),
				...[
					pullCi(
						LOOMRAIL,
						"16455710388",
						MODAL,
						MODAL_PUSHED,
						"2026-08-28T08:16:41Z",
						["16455710395", "success", 334],
						1000000441,
					),
					preview(
						LOOMRAIL,
						"16455710391",
						MODAL,
						MODAL_PUSHED,
						"2026-08-28T08:16:41Z",
						["16455710402", null],
						null,
					),
				].map((run) => linked(run, "exact", ["commit_pushed"], [433])),
			]),
		],
		pullRequests: [
			merged(
				LOOMRAIL,
				433,
				"Make the web modal accessible",
				MODAL,
				"rafa-acme",
				"2026-08-28T10:18:36Z",
			),
		],
	},
	"01a03d6b-18cf-7f53-a916-f0a4f62a2526": {
		runs: [
			sessionRun(7, "2026-08-27T03:59:17.831Z", [
				linked(
					pullCi(
						LOOMRAIL,
						"16138140824",
						CANCELLED_AT,
						"87d7aaacad5469356b04102552c37dc528172f30",
						"2026-08-26T12:47:03Z",
						["16138140831", "failure", 317],
						1000000566,
					),
					"exact",
					["ci_named"],
					[424],
				),
				...[
					CANCELLED_AT_RED,
					preview(
						LOOMRAIL,
						"16503740563",
						CANCELLED_AT,
						CANCELLED_AT_RED.headSha,
						"2026-08-27T04:01:46Z",
						["16503740574", null],
						null,
					),
				].map((run) => linked(run, "exact", ["commit_pushed"], [424])),
			]),
			sessionRun(8, "2026-08-27T04:18:14.336Z", [
				linked(CANCELLED_AT_RED, "exact", ["ci_named"], [424]),
				...[
					pullCi(
						LOOMRAIL,
						"16504912337",
						CANCELLED_AT,
						CANCELLED_AT_GREEN,
						"2026-08-27T04:20:07Z",
						["16504912344", "success", 328],
						1000000609,
					),
					preview(
						LOOMRAIL,
						"16504912340",
						CANCELLED_AT,
						CANCELLED_AT_GREEN,
						"2026-08-27T04:20:07Z",
						["16504912351", null],
						null,
					),
				].map((run) => linked(run, "exact", ["commit_pushed"], [424])),
			]),
		],
		pullRequests: [
			merged(
				LOOMRAIL,
				424,
				"Record when a booking is cancelled",
				CANCELLED_AT,
				"rafa-acme",
				"2026-08-28T15:31:52Z",
			),
		],
	},
	"eb8b212b-52cf-4f5c-a579-5d725615cd3a": {
		runs: [
			sessionRun(1, "2026-08-20T14:47:30.842Z", [
				linked(
					pullCi(
						LOOMRAIL_UI,
						"16451000047",
						DIALOG,
						"a8dba0555d909d1c57150ee2b57db8b4f74a595d",
						"2026-08-20T14:31:18Z",
						["16451000054", "failure", 309],
						1000000484,
					),
					"exact",
					["ci_named"],
					[152],
				),
				...[
					pullCi(
						LOOMRAIL_UI,
						"16452210618",
						DIALOG,
						DIALOG_PUSHED,
						"2026-08-20T14:49:56Z",
						["16452210625", "cancelled", 249],
						1000000517,
					),
					preview(
						LOOMRAIL_UI,
						"16452210621",
						DIALOG,
						DIALOG_PUSHED,
						"2026-08-20T14:49:56Z",
						["16452210632", null],
						null,
					),
				].map((run) => linked(run, "exact", ["commit_pushed"], [152])),
			]),
			sessionRun(2, "2026-08-20T14:53:13.942Z", [
				linked(
					preview(
						LOOMRAIL_UI,
						"17279466508",
						DIALOG,
						DIALOG_DOCUMENTED,
						"2026-08-20T15:02:20Z",
						["17279466511", 147],
						1000000575,
					),
					"exact",
					["ci_named"],
					[152],
				),
				...[
					pullCi(
						LOOMRAIL_UI,
						"16452391772",
						DIALOG,
						DIALOG_DOCUMENTED,
						"2026-08-20T14:54:00Z",
						["16452391779", "success", 317],
						1000000452,
					),
					preview(
						LOOMRAIL_UI,
						"16452391775",
						DIALOG,
						DIALOG_DOCUMENTED,
						"2026-08-20T14:54:00Z",
						["16452391786", null],
						null,
					),
				].map((run) => linked(run, "pr_window", BOTH, [152])),
			]),
		],
		pullRequests: [
			merged(
				LOOMRAIL_UI,
				152,
				"Return focus when Dialog closes",
				DIALOG,
				"marc-acme",
				"2026-08-26T15:04:27Z",
			),
		],
	},
};
