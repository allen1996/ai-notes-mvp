import { PrismaLibSql } from "@prisma/adapter-libsql";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@server/generated/prisma/client.ts";
import { initializeDatabase } from "@server/tables/migrate.ts";
import type { ExportRecord, Matter, Meeting } from "@lib/types/meeting.ts";
import { AppError } from "@server/utils/errors.ts";
import { type AiUsage, FREE_AI_NOTES } from "@lib/types/usage.ts";

/** Anonymous records stay preserved but inaccessible to Clerk users. */
export const LEGACY_OWNER = "__legacy__";
interface Connection {
  db: PrismaClient;
  ready: Promise<void>;
}
type Queries = Prisma.TransactionClient;

/** Scoped repositories share a Prisma connection; every query binds the verified owner. */
export class Repository {
  private connection: Connection;
  private ownsConnection: boolean;
  constructor(
    pathOrConnection: string | Connection,
    readonly ownerId = LEGACY_OWNER,
  ) {
    this.ownsConnection = typeof pathOrConnection === "string";
    if (typeof pathOrConnection === "string") {
      const url = pathToFileURL(resolve(pathOrConnection)).href;
      const db = new PrismaClient({
        adapter: new PrismaLibSql({ url }),
        errorFormat: "minimal",
      });
      this.connection = { db, ready: initializeDatabase(db, LEGACY_OWNER) };
    } else {
      this.connection = pathOrConnection;
    }
  }
  forUser(userId: string) {
    if (!userId || userId === LEGACY_OWNER) {
      throw new AppError(401, "Sign in to access your workspace.");
    }
    return new Repository(this.connection, userId);
  }
  async connect() {
    await this.connection.ready;
  }
  async close() {
    if (this.ownsConnection) {
      try {
        await this.connection.ready;
      } finally {
        await this.connection.db.$disconnect();
      }
    }
  }
  private async client() {
    await this.connection.ready;
    return this.connection.db;
  }
  private key(id: string) {
    return { ownerId_id: { ownerId: this.ownerId, id } };
  }
  async getMeta(key: string): Promise<string | null> {
    const row = await (await this.client()).metadata.findUnique({
      where: { ownerId_key: { ownerId: this.ownerId, key } },
    });
    return row?.value ?? null;
  }
  async setMeta(key: string, value: string) {
    await (await this.client()).metadata.upsert({
      where: { ownerId_key: { ownerId: this.ownerId, key } },
      create: { ownerId: this.ownerId, key, value },
      update: { value },
    });
  }
  /** Startup recovery only; never exposed as an API route. */
  async listUserIds(): Promise<string[]> {
    const rows = await (await this.client()).meetingRecord.findMany({
      where: { ownerId: { not: LEGACY_OWNER } },
      select: { ownerId: true },
      distinct: ["ownerId"],
    });
    return rows.map((row) => row.ownerId);
  }
  async listMeetings(): Promise<Meeting[]> {
    const rows = await (await this.client()).meetingRecord.findMany({
      where: { ownerId: this.ownerId },
    });
    return rows.map((row) => JSON.parse(row.data) as Meeting).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
  async getMeeting(id: string): Promise<Meeting> {
    return this.readMeeting(await this.client(), id);
  }
  private async readMeeting(db: Queries, id: string): Promise<Meeting> {
    const row = await db.meetingRecord.findUnique({ where: this.key(id) });
    if (!row) throw new AppError(404, "Meeting not found.");
    return JSON.parse(row.data);
  }
  async getUsage(): Promise<AiUsage> {
    const record = await (await this.client()).aiUsage.findUnique({
      where: { ownerId: this.ownerId },
    });
    const used = record?.used ?? 0;
    return {
      limit: FREE_AI_NOTES,
      used,
      remaining: Math.max(0, FREE_AI_NOTES - used),
    };
  }
  async assertCreditAvailable() {
    if ((await this.getUsage()).remaining === 0) this.quotaError();
  }
  private quotaError(): never {
    throw new AppError(
      402,
      "You've used all 3 free AI notes. Upgrade to create more, or try an example.",
      "AI_QUOTA_EXHAUSTED",
    );
  }
  private async reserveCredit(tx: Queries) {
    await tx.aiUsage.upsert({
      where: { ownerId: this.ownerId },
      create: { ownerId: this.ownerId, used: 0 },
      update: {},
    });
    const reserved = await tx.aiUsage.updateMany({
      where: { ownerId: this.ownerId, used: { lt: FREE_AI_NOTES } },
      data: { used: { increment: 1 } },
    });
    if (reserved.count !== 1) this.quotaError();
  }
  async createMeeting(meeting: Meeting, useCredit = false) {
    await (await this.client()).$transaction(async (tx) => {
      if (useCredit) await this.reserveCredit(tx);
      await tx.meetingRecord.create({
        data: {
          ownerId: this.ownerId,
          id: meeting.id,
          data: JSON.stringify(meeting),
        },
      });
    });
    return meeting;
  }
  async update(
    id: string,
    mutate: (meeting: Meeting) => Meeting,
  ): Promise<Meeting> {
    return (await this.client()).$transaction(async (tx) => {
      const current = await this.readMeeting(tx, id);
      if (current.status === "deleting") {
        throw new AppError(
          409,
          "Meeting deletion is in progress.",
          "DELETION_IN_PROGRESS",
        );
      }
      const next = mutate(current);
      next.updatedAt = new Date().toISOString();
      await tx.meetingRecord.update({
        where: this.key(id),
        data: { data: JSON.stringify(next) },
      });
      return next;
    });
  }
  async listMatters(): Promise<Matter[]> {
    const rows = await (await this.client()).matterRecord.findMany({
      where: { ownerId: this.ownerId },
      orderBy: { reference: "asc" },
    });
    return rows.map((row) => JSON.parse(row.data));
  }
  async getMatter(id: string): Promise<Matter | null> {
    const row = await (await this.client()).matterRecord.findUnique({
      where: this.key(id),
    });
    return row ? JSON.parse(row.data) : null;
  }
  async createMatter(matter: Matter) {
    try {
      await (await this.client()).matterRecord.create({
        data: {
          ownerId: this.ownerId,
          id: matter.id,
          reference: matter.reference,
          data: JSON.stringify(matter),
        },
      });
      return matter;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(409, "A matter with that reference already exists.");
      }
      throw error;
    }
  }
  async exportMeeting(
    id: string,
    makeExport: (meeting: Meeting) => ExportRecord,
  ): Promise<Meeting> {
    return (await this.client()).$transaction(async (tx) => {
      const meeting = await this.readMeeting(tx, id);
      if (meeting.export) return meeting;
      const record = makeExport(meeting);
      const next: Meeting = {
        ...meeting,
        status: "saved",
        export: record,
        updatedAt: record.createdAt,
      };
      await tx.meetingRecord.update({
        where: this.key(id),
        data: { data: JSON.stringify(next) },
      });
      await tx.exportRecord.create({
        data: {
          ownerId: this.ownerId,
          meetingId: id,
          data: JSON.stringify(record),
        },
      });
      return next;
    });
  }
  async listExports(): Promise<ExportRecord[]> {
    const rows = await (await this.client()).exportRecord.findMany({
      where: { ownerId: this.ownerId },
    });
    return rows.map((row) => JSON.parse(row.data));
  }
  async retryMeeting(id: string) {
    return (await this.client()).$transaction(async (tx) => {
      const meeting = await this.readMeeting(tx, id);
      if (meeting.status !== "failed") {
        throw new AppError(409, "Only failed meetings can be retried.");
      }
      if (meeting.source !== "demo") await this.reserveCredit(tx);
      const next: Meeting = {
        ...meeting,
        status: "queued",
        error: undefined,
        updatedAt: new Date().toISOString(),
      };
      await tx.meetingRecord.update({
        where: this.key(id),
        data: { data: JSON.stringify(next) },
      });
      return next;
    });
  }
  async beginDeletion(id: string): Promise<Meeting> {
    return (await this.client()).$transaction(async (tx) => {
      const meeting = await this.readMeeting(tx, id);
      const next: Meeting = {
        ...meeting,
        status: "deleting",
        updatedAt: new Date().toISOString(),
      };
      await tx.meetingRecord.update({
        where: this.key(id),
        data: { data: JSON.stringify(next) },
      });
      return next;
    });
  }
  async finishDeletion(id: string) {
    await (await this.client()).$transaction(async (tx) => {
      const meeting = await this.readMeeting(tx, id);
      if (meeting.status !== "deleting") {
        throw new AppError(409, "Confirm meeting deletion first.");
      }
      await tx.exportRecord.deleteMany({
        where: { ownerId: this.ownerId, meetingId: id },
      });
      await tx.meetingRecord.delete({ where: this.key(id) });
    });
  }
}
