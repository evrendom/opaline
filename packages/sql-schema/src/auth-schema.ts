import {
	boolean,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	jobTitle: text("job_title"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", {
		withTimezone: true,
		mode: "date",
	}),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
		withTimezone: true,
		mode: "date",
	}),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const organization = pgTable("organization", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	logo: text("logo"),
	metadata: text("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

export const member = pgTable("member", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	role: text("role").notNull().default("member"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

export const invitation = pgTable("invitation", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	role: text("role"),
	status: text("status").notNull().default("pending"),
	expiresAt: timestamp("expires_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	inviterId: text("inviter_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	teamId: text("team_id"),
});

export const apikey = pgTable("apikey", {
	id: text("id").primaryKey(),
	configId: text("config_id").notNull().default("default"),
	name: text("name"),
	start: text("start"),
	prefix: text("prefix"),
	key: text("key").notNull().unique(),
	referenceId: text("reference_id").notNull(),
	refillInterval: integer("refill_interval"),
	refillAmount: integer("refill_amount"),
	lastRefillAt: timestamp("last_refill_at", {
		withTimezone: true,
		mode: "date",
	}),
	enabled: boolean("enabled").default(true).notNull(),
	rateLimitEnabled: boolean("rate_limit_enabled").default(true).notNull(),
	rateLimitTimeWindow: integer("rate_limit_time_window"),
	rateLimitMax: integer("rate_limit_max"),
	requestCount: integer("request_count").default(0).notNull(),
	remaining: integer("remaining"),
	lastRequest: timestamp("last_request", { withTimezone: true, mode: "date" }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
	permissions: text("permissions"),
	metadata: text("metadata"),
});

export const deviceCode = pgTable("deviceCode", {
	id: text("id").primaryKey(),
	deviceCode: text("device_code").notNull().unique(),
	userCode: text("user_code").notNull().unique(),
	userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
	expiresAt: timestamp("expires_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	status: text("status").notNull(),
	lastPolledAt: timestamp("last_polled_at", {
		withTimezone: true,
		mode: "date",
	}),
	pollingInterval: integer("polling_interval"),
	clientId: text("client_id"),
	scope: text("scope"),
});

// OAuth clients and tokens for the MCP plugin (Codex / ChatGPT connectors).
export const oauthApplication = pgTable("oauthApplication", {
	id: text("id").primaryKey(),
	name: text("name"),
	icon: text("icon"),
	metadata: text("metadata"),
	clientId: text("client_id").notNull().unique(),
	clientSecret: text("client_secret"),
	redirectUrls: text("redirect_urls").notNull(),
	type: text("type").notNull(),
	authenticationScheme: text("authentication_scheme"),
	disabled: boolean("disabled").default(false),
	userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

export const oauthAccessToken = pgTable("oauthAccessToken", {
	id: text("id").primaryKey(),
	accessToken: text("access_token").notNull().unique(),
	refreshToken: text("refresh_token").notNull().unique(),
	accessTokenExpiresAt: timestamp("access_token_expires_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	clientId: text("client_id")
		.notNull()
		.references(() => oauthApplication.clientId, { onDelete: "cascade" }),
	userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
	scopes: text("scopes").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

export const oauthConsent = pgTable("oauthConsent", {
	id: text("id").primaryKey(),
	clientId: text("client_id")
		.notNull()
		.references(() => oauthApplication.clientId, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	scopes: text("scopes").notNull(),
	consentGiven: boolean("consent_given").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

// Settings the user edits on the Opaline plugin page in ChatGPT and Codex.
export const mcpUserSetting = pgTable("mcp_user_setting", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	defaultWorkspace: text("default_workspace"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

export type UserSelect = typeof user.$inferSelect;
export type UserInsert = typeof user.$inferInsert;
export type SessionSelect = typeof session.$inferSelect;
export type SessionInsert = typeof session.$inferInsert;
export type AccountSelect = typeof account.$inferSelect;
export type AccountInsert = typeof account.$inferInsert;
export type VerificationSelect = typeof verification.$inferSelect;
export type VerificationInsert = typeof verification.$inferInsert;
export type OrganizationSelect = typeof organization.$inferSelect;
export type OrganizationInsert = typeof organization.$inferInsert;
export type MemberSelect = typeof member.$inferSelect;
export type MemberInsert = typeof member.$inferInsert;
export type InvitationSelect = typeof invitation.$inferSelect;
export type InvitationInsert = typeof invitation.$inferInsert;
export type ApiKeySelect = typeof apikey.$inferSelect;
export type ApiKeyInsert = typeof apikey.$inferInsert;
export type DeviceCodeSelect = typeof deviceCode.$inferSelect;
export type DeviceCodeInsert = typeof deviceCode.$inferInsert;
