import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import {
	buildAttioCompanyCustomer360Request,
	buildAttioSignupRequests,
	buildAttioUserActivityRequest,
	getAttioCompanyDomain,
	readAttioErrorDetail,
	syncSignupToAttio,
} from "../attio.js";
import { buildAttioCustomer360 } from "../services/attio-company.service.js";

const signupUser = {
	createdAt: "2026-09-01T08:00:00.000Z",
	email: "alice@acme.com",
	id: "opaline-user-123",
	name: "Alice Example",
};

describe("Attio signup sync", () => {
	test("does nothing when Attio is not configured", async () => {
		expect(buildAttioSignupRequests(undefined, signupUser)).toEqual([]);
		await expect(
			syncSignupToAttio(undefined, signupUser),
		).resolves.toBeUndefined();
	});

	test("builds idempotent Company, Person, and User upserts", async () => {
		const requests = buildAttioSignupRequests(
			{ accessToken: " test-token " },
			signupUser,
		);
		const companyRequest = requests[0];
		const personRequest = requests[1];
		const userRequest = requests[2];
		assert(companyRequest);
		assert(personRequest);
		assert(userRequest);
		expect(requests).toHaveLength(3);

		expect(companyRequest.url).toBe(
			"https://api.attio.com/v2/objects/companies/records?matching_attribute=domains",
		);
		expect(await companyRequest.json()).toEqual({
			data: { values: { domains: ["acme.com"] } },
		});

		expect(personRequest.method).toBe("PUT");
		expect(personRequest.url).toBe(
			"https://api.attio.com/v2/objects/people/records?matching_attribute=email_addresses",
		);
		expect(personRequest.headers.get("Authorization")).toBe(
			"Bearer test-token",
		);
		expect(await personRequest.json()).toEqual({
			data: {
				values: {
					company: ["acme.com"],
					email_addresses: ["alice@acme.com"],
					name: [
						{
							first_name: "Alice",
							full_name: "Alice Example",
							last_name: "Example",
						},
					],
					opaline_user_id: ["opaline-user-123"],
				},
			},
		});

		expect(userRequest.url).toBe(
			"https://api.attio.com/v2/objects/users/records?matching_attribute=user_id",
		);
		expect(await userRequest.json()).toEqual({
			data: {
				values: {
					opaline_agent_runs_30d: [0],
					opaline_joined_at: ["2026-09-01T08:00:00.000Z"],
					opaline_last_active_at: [],
					person: ["alice@acme.com"],
					primary_email_address: ["alice@acme.com"],
					user_id: ["opaline-user-123"],
				},
			},
		});
	});

	test("does not sync synthetic signups", () => {
		for (const user of [
			{ ...signupUser, email: "smoke-42@opaline.so" },
			{ ...signupUser, email: "e.k.dombak+smokesmoke12@gmail.com" },
			{ ...signupUser, email: "developer@example.com" },
			{ ...signupUser, email: "evren@test.com" },
		]) {
			expect(
				buildAttioSignupRequests({ accessToken: "test-token" }, user),
			).toEqual([]);
		}
	});

	test("does not create companies for personal email domains", async () => {
		expect(getAttioCompanyDomain("alice@gmail.com")).toBeUndefined();
		expect(getAttioCompanyDomain("alice@icloud.com")).toBeUndefined();
		expect(getAttioCompanyDomain("alice@pm.me")).toBeUndefined();
		expect(getAttioCompanyDomain("alice@inbox.33mail.com")).toBeUndefined();
		expect(getAttioCompanyDomain("alice@acme.com")).toBe("acme.com");

		const requests = buildAttioSignupRequests(
			{ accessToken: "test-token" },
			{ ...signupUser, email: "alice@gmail.com" },
		);
		expect(requests).toHaveLength(2);
		expect(requests[0]?.url).toContain("/objects/people/");
		expect(requests[1]?.url).toContain("/objects/users/");
		expect(await requests[0]?.json()).not.toHaveProperty("data.values.company");
	});
});

describe("Attio customer 360", () => {
	test("aggregates people, usage, billing, and product accounts by domain", () => {
		const customer360 = buildAttioCustomer360(
			[
				{
					created_at: "2026-08-01T00:00:00.000Z",
					email: "alice@acme.com",
					id: "alice",
					name: "Alice",
				},
				{
					created_at: "2026-08-02T00:00:00.000Z",
					email: "bob@acme.com",
					id: "bob",
					name: "Bob",
				},
				{
					created_at: "2026-08-03T00:00:00.000Z",
					email: "carol@gmail.com",
					id: "carol",
					name: "Carol",
				},
				{
					created_at: "2026-08-04T00:00:00.000Z",
					email: "smoke@widgets.dev",
					id: "synthetic",
					name: "Smoke",
				},
			],
			[
				{
					billing_plan: "free",
					organization_id: "personal-account",
					payment_status: "free",
					user_id: "alice",
				},
				{
					billing_plan: "business",
					organization_id: "team-account",
					payment_status: "paid",
					user_id: "alice",
				},
				{
					billing_plan: "business",
					organization_id: "team-account",
					payment_status: "paid",
					user_id: "bob",
				},
			],
			[
				{
					agent_runs_7d: 2,
					agent_runs_30d: 5,
					last_active_at: "2026-09-20T10:00:00.000Z",
					user_id: "alice",
				},
				{
					agent_runs_7d: 3,
					agent_runs_30d: 7,
					last_active_at: "2026-09-21T10:00:00.000Z",
					user_id: "bob",
				},
			],
		);

		expect(customer360.companies).toEqual([
			{
				activeDevelopers30d: 2,
				agentRuns7d: 5,
				agentRuns30d: 12,
				billingPlan: "business",
				developerCount: 2,
				domain: "acme.com",
				lastActiveAt: "2026-09-21T10:00:00.000Z",
				paidWorkspaceCount: 1,
				paymentStatus: "paid",
				workspaceCount: 2,
			},
		]);
		expect(customer360.people.map((person) => person.email)).toEqual([
			"alice@acme.com",
			"bob@acme.com",
			"carol@gmail.com",
		]);
	});

	test("serializes company rollups and user activity", async () => {
		const companyRequest = buildAttioCompanyCustomer360Request(
			{ accessToken: "test-token" },
			{
				activeDevelopers30d: 2,
				agentRuns7d: 4,
				agentRuns30d: 9,
				billingPlan: "basic",
				developerCount: 3,
				domain: "acme.com",
				lastActiveAt: "2026-09-24T10:00:00.000Z",
				paidWorkspaceCount: 1,
				paymentStatus: "paid",
				workspaceCount: 2,
			},
		);
		assert(companyRequest);
		expect(await companyRequest.json()).toMatchObject({
			data: {
				values: {
					domains: ["acme.com"],
					opaline_active_developers_30d: [2],
					opaline_agent_runs_30d: [9],
					opaline_developers: [3],
					opaline_last_active_at: ["2026-09-24T10:00:00.000Z"],
				},
			},
		});

		const activityRequest = buildAttioUserActivityRequest(
			{ accessToken: "test-token" },
			{
				agentRuns30d: undefined,
				email: "alice@acme.com",
				lastActiveAt: "2026-09-24T11:00:00.000Z",
				userId: "alice",
			},
		);
		assert(activityRequest);
		expect(await activityRequest.json()).toEqual({
			data: {
				values: {
					opaline_last_active_at: ["2026-09-24T11:00:00.000Z"],
					primary_email_address: ["alice@acme.com"],
					user_id: ["alice"],
				},
			},
		});
	});
});

describe("Attio errors", () => {
	test("extracts only the bounded error code and message", async () => {
		const detail = await readAttioErrorDetail(
			new Response(
				JSON.stringify({
					code: "validation_error",
					message: "Attribute billing_plan does not accept this value",
					request_id: "request-secret",
				}),
				{ status: 400 },
			),
		);

		expect(detail).toBe(
			"validation_error: Attribute billing_plan does not accept this value",
		);
	});
});
