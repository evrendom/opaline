import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionMemberProfilePreview } from "./session-member-profile-preview";

describe("SessionMemberProfilePreview", () => {
	test("uses an avatar-only 18 pixel trigger and keeps the member name visually hidden in the row", () => {
		const markup = renderToStaticMarkup(
			<SessionMemberProfilePreview
				avatarUrl="/avatar.webp"
				profile={{ activity: [1, 3, 2], favoriteModel: "gpt-5" }}
				userLabel="Evren"
			/>,
		);

		expect(markup).toContain('data-slot="session-member-profile-trigger"');
		expect(markup).toContain('class="relative flex size-4.5');
		expect(markup).toContain('height="18"');
		expect(markup).toContain('width="18"');
		expect(markup).toContain('<span class="sr-only">Evren</span>');
	});
});
