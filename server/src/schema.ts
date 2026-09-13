import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, jsonb, uuid } from "drizzle-orm/pg-core";

// ==================== Users ====================
export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 128 }),
    avatar_url: varchar("avatar_url", { length: 512 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

export type User = typeof users.$inferSelect;

// ==================== User Settings ====================
export const userSettings = pgTable(
  "user_settings",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
    default_model: varchar("default_model", { length: 128 }).default("doubao-seed-2-0-pro-260215"),
    theme: varchar("theme", { length: 32 }).default("dark"),
    language: varchar("language", { length: 16 }).default("zh-CN"),
    stream_output: boolean("stream_output").default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

// ==================== Conversations ====================
export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }).default("新对话"),
    model: varchar("model", { length: 128 }).default("doubao-seed-2-0-pro-260215"),
    system_prompt: text("system_prompt"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

// ==================== Messages ====================
export const messages = pgTable(
  "messages",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// ==================== Knowledge Bases ====================
export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    description: text("description").default(""),
    icon: varchar("icon", { length: 64 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

// ==================== Documents ====================
export const documents = pgTable(
  "documents",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    knowledge_base_id: varchar("knowledge_base_id", { length: 36 }).notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 512 }).notNull(),
    file_path: varchar("file_path", { length: 1024 }),
    file_size: integer("file_size").default(0),
    content_preview: text("content_preview"),
    chunk_count: integer("chunk_count").default(0),
    status: varchar("status", { length: 32 }).default("processing"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

// ==================== Document Chunks (for RAG) ====================
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    document_id: varchar("document_id", { length: 36 }).notNull().references(() => documents.id, { onDelete: "cascade" }),
    knowledge_base_id: varchar("knowledge_base_id", { length: 36 }).notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    chunk_index: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    // Embedding vector: using pgvector, defined via SQL
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// ==================== Knowledge Shares ====================
export const knowledgeShares = pgTable(
  "knowledge_shares",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    knowledge_base_id: varchar("knowledge_base_id", { length: 36 }).notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    share_token: varchar("share_token", { length: 64 }).notNull().unique(),
    created_by: varchar("created_by", { length: 36 }).notNull().references(() => users.id),
    permission: varchar("permission", { length: 16 }).default("read"),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    is_active: boolean("is_active").default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// ==================== Knowledge Collaborators ====================
export const knowledgeCollaborators = pgTable(
  "knowledge_collaborators",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    knowledge_base_id: varchar("knowledge_base_id", { length: 36 }).notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    user_email: varchar("user_email", { length: 255 }).notNull(),
    permission: varchar("permission", { length: 16 }).default("read"),
    invited_by: varchar("invited_by", { length: 36 }).notNull().references(() => users.id),
    invited_at: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
  }
);

// ==================== Video Tasks ====================
export const videoTasks = pgTable(
  "video_tasks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    status: varchar("status", { length: 32 }).default("queued"),
    video_url: varchar("video_url", { length: 1024 }),
    thumbnail_url: varchar("thumbnail_url", { length: 1024 }),
    model: varchar("model", { length: 128 }).default("doubao-seedance-2-0-260128"),
    duration: integer("duration").default(5),
    ratio: varchar("ratio", { length: 16 }).default("16:9"),
    resolution: varchar("resolution", { length: 16 }).default("720p"),
    input_type: varchar("input_type", { length: 16 }).default("text"),
    image_url: varchar("image_url", { length: 1024 }),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

// ==================== Search History ====================
export const searchHistory = pgTable(
  "search_history",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    query: varchar("query", { length: 512 }).notNull(),
    result_count: integer("result_count").default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// ==================== Health Check ====================
export const healthCheck = pgTable("health_check", {
  id: integer("id").notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});
