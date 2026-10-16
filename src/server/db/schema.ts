import { relations } from "drizzle-orm";
import { index, pgTableCreator, primaryKey } from "drizzle-orm/pg-core";
import { type AdapterAccount } from "next-auth/adapters";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `baby_app_${name}`);

/**
 * A baby nap. `endTime` is null while the nap is in progress (timer running).
 * All timestamps are stored with timezone. Each nap belongs to a user.
 */
export const naps = createTable(
  "nap",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    startTime: d.timestamp({ withTimezone: true }).notNull(),
    endTime: d.timestamp({ withTimezone: true }),
    note: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("nap_start_time_idx").on(t.startTime),
    index("nap_user_id_idx").on(t.userId),
  ],
);

export const napsRelations = relations(naps, ({ one }) => ({
  user: one(users, { fields: [naps.userId], references: [users.id] }),
}));

/**
 * A night-sleep session. Like a nap it has a start and a (nullable while
 * running) end, but it additionally owns a set of "splits" — wake-up intervals
 * recorded without stopping the clock. See docs/lock-screen-and-sleep.md.
 */
export const sleepSessions = createTable(
  "sleep_session",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    startTime: d.timestamp({ withTimezone: true }).notNull(),
    endTime: d.timestamp({ withTimezone: true }),
    note: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("sleep_session_start_time_idx").on(t.startTime),
    index("sleep_session_user_id_idx").on(t.userId),
  ],
);

/**
 * A wake-up interval within a sleep session. `startTime` is when the baby woke;
 * `endTime` is when they resettled (null if still awake when the session was
 * stopped). Deleting a session cascades to its splits.
 */
export const sleepSplits = createTable(
  "sleep_split",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    sessionId: d
      .integer()
      .notNull()
      .references(() => sleepSessions.id, { onDelete: "cascade" }),
    startTime: d.timestamp({ withTimezone: true }).notNull(),
    endTime: d.timestamp({ withTimezone: true }),
    note: d.varchar({ length: 256 }),
  }),
  (t) => [index("sleep_split_session_id_idx").on(t.sessionId)],
);

export const sleepSessionsRelations = relations(
  sleepSessions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [sleepSessions.userId],
      references: [users.id],
    }),
    splits: many(sleepSplits),
  }),
);

export const sleepSplitsRelations = relations(sleepSplits, ({ one }) => ({
  session: one(sleepSessions, {
    fields: [sleepSplits.sessionId],
    references: [sleepSessions.id],
  }),
}));

export const users = createTable("user", (d) => ({
  id: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: d.varchar({ length: 255 }),
  email: d.varchar({ length: 255 }).notNull(),
  emailVerified: d
    .timestamp({
      mode: "date",
      withTimezone: true,
    })
    .$defaultFn(() => /* @__PURE__ */ new Date()),
  image: d.varchar({ length: 255 }),
  // bcrypt hash for email/password (credentials) login.
  hashedPassword: d.varchar({ length: 255 }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}));

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    type: d.varchar({ length: 255 }).$type<AdapterAccount["type"]>().notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("account_user_id_idx").on(t.userId),
  ],
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("t_user_id_idx").on(t.userId)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);
