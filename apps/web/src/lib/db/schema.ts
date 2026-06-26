import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
	id: text("id").primaryKey(),

	// todo: implement fully anonymous sign-in for privacy
	// we don't have any auth flows currently so this is fine for now
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	createdAt: timestamp("created_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
	updatedAt: timestamp("updated_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
}).enableRLS();

export const sessions = pgTable("sessions", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
}).enableRLS();

export const accounts = pgTable("accounts", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
}).enableRLS();

export const verifications = pgTable("verifications", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").$defaultFn(
		() => /* @__PURE__ */ new Date(),
	),
	updatedAt: timestamp("updated_at").$defaultFn(
		() => /* @__PURE__ */ new Date(),
	),
}).enableRLS();

// --- Ingest Pipeline Schemas ---

export const assetMetadata = pgTable("asset_metadata", {
	id: text("id").primaryKey(),
	assetId: text("asset_id").notNull().unique(), // The OPFS/Project asset ID
	status: text("status").default("pending"), // 'pending', 'completed', 'error'
	metadata: jsonb("metadata"), // EXIF/ffprobe data
	normalizedUrl: text("normalized_url"), // URL to backend-normalized proxy
	thumbnailUrl: text("thumbnail_url"), // URL to backend-generated thumbnail
	createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
	updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
});

export const transcripts = pgTable("transcripts", {
	id: text("id").primaryKey(),
	assetId: text("asset_id").notNull().references(() => assetMetadata.assetId, { onDelete: "cascade" }),
	language: text("language"),
	segments: jsonb("segments"), // Array of { start, end, text, words }
	createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

export const detectedObjects = pgTable("detected_objects", {
	id: text("id").primaryKey(),
	assetId: text("asset_id").notNull().references(() => assetMetadata.assetId, { onDelete: "cascade" }),
	timestamp: timestamp("timestamp"), // The time in the video
	timeOffset: text("time_offset"), // or float? Use text for now to avoid decimal precision issues, or float if supported
	label: text("label").notNull(),
	confidence: text("confidence"), // float stored as string or actual numeric
	boundingBox: jsonb("bounding_box"), // { x, y, w, h }
	createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

export const sceneDescriptions = pgTable("scene_descriptions", {
	id: text("id").primaryKey(),
	assetId: text("asset_id").notNull().references(() => assetMetadata.assetId, { onDelete: "cascade" }),
	timeStart: text("time_start"), // float string
	timeEnd: text("time_end"),     // float string
	description: text("description").notNull(),
	tags: jsonb("tags"), // Array of string tags from CLIP
	createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

