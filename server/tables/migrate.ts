import type { PrismaClient } from "@server/generated/prisma/client.ts";
import { SCHEMA } from "@server/tables/schema.ts";
import { FREE_AI_NOTES } from "@lib/types/usage.ts";

/** Compatibility bootstrap only: regular data access uses the generated ORM. */
export async function initializeDatabase(
  db: PrismaClient,
  legacyOwner: string,
) {
  await db.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await db.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  await db.$transaction(async (tx) => {
    const columns = await tx.$queryRawUnsafe<{ name: string }[]>(
      "PRAGMA table_info(meetings)",
    );
    const legacy = columns.length > 0 &&
      !columns.some((column) => column.name === "owner_id");
    if (legacy) {
      for (const table of ["meetings", "matters", "exports", "metadata"]) {
        await tx.$executeRawUnsafe(
          `ALTER TABLE ${table} RENAME TO legacy_${table}`,
        );
      }
    }
    for (
      const statement of SCHEMA.split(";").map((sql) => sql.trim()).filter(
        Boolean,
      )
    ) {
      await tx.$executeRawUnsafe(statement);
    }
    if (legacy) {
      for (
        const [table, fields] of [
          ["meetings", "id, data"],
          ["matters", "id, reference, data"],
          ["exports", "meeting_id, data"],
          ["metadata", "key, value"],
        ]
      ) {
        // Identifiers are fixed constants; the owner value is bound as a parameter.
        await tx.$executeRawUnsafe(
          `INSERT INTO ${table} SELECT ?, ${fields} FROM legacy_${table}`,
          legacyOwner,
        );
        await tx.$executeRawUnsafe(`DROP TABLE legacy_${table}`);
      }
    }
    // Backfill once for existing users, including failed recordings. Never lower a ledger.
    await tx.$executeRawUnsafe(
      `INSERT OR IGNORE INTO ai_usage (owner_id, used)
       SELECT owner_id, MIN(?, COUNT(*)) FROM meetings
       WHERE owner_id <> ? AND json_extract(data, '$.source') <> 'demo'
       GROUP BY owner_id`,
      FREE_AI_NOTES,
      legacyOwner,
    );
    await tx.$executeRawUnsafe("PRAGMA user_version = 3");
  });
}
