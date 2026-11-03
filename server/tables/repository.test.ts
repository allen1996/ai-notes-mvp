import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "@server/tables/schema.ts";
import { Repository } from "@server/tables/repository.ts";
import {
  equal,
  fixture,
  readyMeeting,
  rejects,
} from "@server/utils/test-helpers.ts";

Deno.test("Prisma opens an existing owner-scoped SQLite database without rewriting data", async () => {
  const { workflow, close } = fixture();
  const meeting = await readyMeeting(workflow);
  await close();
  const dir = await Deno.makeTempDir();
  const path = `${dir}/existing.sqlite`;
  const old = new DatabaseSync(path);
  old.exec(SCHEMA);
  const serialized = JSON.stringify(meeting);
  old.prepare("INSERT INTO meetings VALUES (?, ?, ?)").run(
    "alice",
    meeting.id,
    serialized,
  );
  old.prepare("INSERT INTO matters VALUES (?, ?, ?, ?)").run(
    "alice",
    "matter",
    "REF-1",
    JSON.stringify({
      id: "matter",
      reference: "REF-1",
      name: "Existing",
      client: "Alice",
    }),
  );
  old.prepare("INSERT INTO metadata VALUES (?, ?, ?)").run(
    "alice",
    "seeded",
    "true",
  );
  old.close();
  const root = new Repository(path);
  try {
    const alice = root.forUser("alice");
    const bob = root.forUser("bob");
    equal(await alice.getMeeting(meeting.id), meeting);
    equal(await alice.getMeta("seeded"), "true");
    equal(await bob.listMeetings(), []);
    await rejects(() => bob.getMeeting(meeting.id), "not found");
    await rejects(
      () =>
        alice.createMatter({
          id: "duplicate",
          reference: "ref-1",
          name: "Duplicate",
          client: "Alice",
        }),
      "already exists",
    );
    await bob.createMatter({
      id: "matter",
      reference: "REF-1",
      name: "Separate",
      client: "Bob",
    });
    equal((await bob.listMatters()).length, 1);
  } finally {
    await root.close();
    const check = new DatabaseSync(path);
    equal(
      check.prepare("SELECT data FROM meetings WHERE owner_id = ? AND id = ?")
        .get("alice", meeting.id)?.data,
      serialized,
    );
    check.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("existing recordings backfill lifetime usage once; examples stay free and deletion cannot reset it", async () => {
  const { workflow, close } = fixture();
  const meeting = await readyMeeting(workflow);
  await close();
  const dir = await Deno.makeTempDir();
  const path = `${dir}/existing.sqlite`;
  const old = new DatabaseSync(path);
  old.exec(SCHEMA);
  old.exec("DROP TABLE ai_usage");
  const insert = old.prepare("INSERT INTO meetings VALUES (?, ?, ?)");
  for (
    const [owner, count, source] of [
      ["alice", 5, "upload"],
      ["bob", 1, "microphone"],
      ["bob", 8, "demo"],
      ["example-only", 4, "demo"],
    ] as const
  ) {
    for (let i = 0; i < count; i++) {
      const id = `${source}-${i}`;
      insert.run(owner, id, JSON.stringify({ ...meeting, id, source }));
    }
  }
  old.close();
  let root = new Repository(path);
  try {
    equal((await root.forUser("alice").getUsage()).used, 3);
    equal((await root.forUser("bob").getUsage()).used, 1);
    equal((await root.forUser("example-only").getUsage()).used, 0);
    const alice = root.forUser("alice");
    for (const item of await alice.listMeetings()) {
      await alice.beginDeletion(item.id);
      await alice.finishDeletion(item.id);
    }
    await root.close();
    root = new Repository(path);
    equal((await root.forUser("alice").getUsage()).remaining, 0);
  } finally {
    await root.close();
    await Deno.remove(dir, { recursive: true });
  }
});
