import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
	CLI_UPDATE_DISMISSED_STORAGE_KEY,
	CliUpdateNoticeContent,
} from "./CliUpdateNotice";

const outdated = {
	installedVersion: "0.9.0",
	latestVersion: "0.11.0",
	outdated: true,
};

describe("CliUpdateNoticeContent", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("shows the versions, the update command, and the release link when outdated", () => {
		render(<CliUpdateNoticeContent status={outdated} />);
		const notice = screen.getByRole("region", { name: "Opaline CLI update" });
		expect(notice).toHaveTextContent("CLI update");
		expect(notice).toHaveTextContent("0.9.0 → 0.11.0");
		expect(
			screen.getByRole("button", { name: "Copy update command" }),
		).toHaveAttribute("title", "npx opaline@latest update");
		expect(screen.getByRole("link", { name: /What's new/ })).toHaveAttribute(
			"href",
			"https://github.com/evrendom/opaline/releases/tag/opaline-cli%400.11.0",
		);
	});

	it("renders nothing while loading, when current, or when a version is unknown", () => {
		const { rerender } = render(<CliUpdateNoticeContent status={undefined} />);
		expect(screen.queryByRole("region")).toBeNull();
		rerender(
			<CliUpdateNoticeContent status={{ ...outdated, outdated: false }} />,
		);
		expect(screen.queryByRole("region")).toBeNull();
		rerender(
			<CliUpdateNoticeContent
				status={{
					installedVersion: null,
					latestVersion: "0.11.0",
					outdated: false,
				}}
			/>,
		);
		expect(screen.queryByRole("region")).toBeNull();
	});

	it("dismisses per latest version and shows again for a newer release", async () => {
		const user = userEvent.setup();
		const first = render(<CliUpdateNoticeContent status={outdated} />);
		await user.click(
			screen.getByRole("button", { name: "Dismiss CLI update notice" }),
		);
		expect(screen.queryByRole("region")).toBeNull();
		expect(window.localStorage.getItem(CLI_UPDATE_DISMISSED_STORAGE_KEY)).toBe(
			"0.11.0",
		);

		// Same release stays dismissed across remounts.
		first.unmount();
		const second = render(<CliUpdateNoticeContent status={outdated} />);
		expect(screen.queryByRole("region")).toBeNull();

		// A newer release shows the notice again.
		second.rerender(
			<CliUpdateNoticeContent
				status={{ ...outdated, latestVersion: "0.12.0" }}
			/>,
		);
		expect(screen.getByRole("region")).toHaveTextContent("0.9.0 → 0.12.0");
	});
});
