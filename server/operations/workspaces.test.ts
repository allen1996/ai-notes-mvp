import { DatabaseSync } from "node:sqlite";
import { Repository } from "@server/tables/repository.ts";
import { Workspaces } from "@server/operations/workspaces.ts";
import { MockProvider } from "@server/infra/mock-note-provider.ts";
import {
  assert,
  equal,
  fixture,
  readyMeeting,
  rejects,
} from "@server/utils/test-helpers.ts";

Deno.test("users have isolated meetings, matter references, metadata, exports, and seed data", async () => {
  const storage = await Deno.makeTempDir();
  const root = new Repository(`${storage}/test.sqlite`);
  const mock = new MockProvider(0);
  const workspaces = new Workspaces(
    root,
    { mock, assemblyai: mock },
    "mock",
    true,
  );
  try {
    const [alice, bob] = await Promise.all([
      workspaces.get("user_alice"),
      workspaces.get("user_bob"),
    ]);
    equal((await alice.repo.listMeetings()).length, 3);
    equal((await bob.repo.listMeetings()).length, 3);
    assert(await workspaces.get("user_alice") === alice);
    const meeting = await readyMeeting(alice);
    await rejects(() => bob.repo.getMeeting(meeting.id), "not found");
    await rejects(
      () => bob.patch(meeting.id, { title: "Stolen" }),
      "not found",
    );
    await rejects(() => bob.retry(meeting.id), "not found");
    await alice.patch(meeting.id, { matterId: "mitchell" });
    await alice.saveToMatter(meeting.id, true);
    equal((await alice.repo.listExports()).length, 1);
    equal((await bob.repo.listExports()).length, 0);
    await bob.repo.createMatter({
      id: "bob-private",
      reference: "SAME-REF",
      name: "Bob matter",
      client: "Bob",
    });
    await alice.repo.createMatter({
      id: "alice-private",
      reference: "SAME-REF",
      name: "Alice matter",
      client: "Alice",
    });
    await rejects(
      () => alice.patch("demo-mitchell", { matterId: "bob-private" }),
      "existing matter",
    );
    equal(await bob.repo.getMatter("alice-private"), null);
    await alice.repo.setMeta("private", "alice-only");
    equal(await bob.repo.getMeta("private"), null);
  } finally {
    await workspaces.idle();
    await root.close();
    await Deno.remove(storage, { recursive: true });
  }
});

Deno.test("schema migration preserves anonymous records without giving them to a signed-in user", async () => {
  const { workflow, close } = fixture();
  const sample = await readyMeeting(workflow);
  await close();
  const dir = await Deno.makeTempDir();
  const path = `${dir}/legacy.sqlite`;
  const old = new DatabaseSync(path);
  old.exec(
    "CREATE TABLE meetings(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE matters(id TEXT PRIMARY KEY,reference TEXT UNIQUE COLLATE NOCASE NOT NULL,data TEXT NOT NULL); CREATE TABLE exports(meeting_id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);",
  );
  old.prepare("INSERT INTO meetings VALUES (?,?)").run(
    sample.id,
    JSON.stringify(sample),
  );
  old.prepare("INSERT INTO matters VALUES (?,?,?)").run(
    "m",
    "REF",
    JSON.stringify({
      id: "m",
      reference: "REF",
      name: "Legacy",
      client: "Client",
    }),
  );
  old.prepare("INSERT INTO exports VALUES (?,?)").run(
    sample.id,
    JSON.stringify({ id: "legacy-export" }),
  );
  old.prepare("INSERT INTO metadata VALUES (?,?)").run("seeded", "true");
  old.close();
  let root = new Repository(path);
  try {
    equal((await root.listMeetings()).length, 1);
    equal((await root.listMatters()).length, 1);
    equal((await root.listExports()).length, 1);
    equal(await root.getMeta("seeded"), "true");
    const alice = root.forUser("user_alice");
    equal(await alice.listMeetings(), []);
    equal(await alice.listMatters(), []);
    equal(await alice.listExports(), []);
    equal(await alice.getMeta("seeded"), null);
    assert((await root.listUserIds()).length === 0);
    await root.close();
    root = new Repository(path);
    equal((await root.listMeetings()).length, 1);
  } finally {
    await root.close();
    await Deno.remove(dir, { recursive: true });
  }
});
