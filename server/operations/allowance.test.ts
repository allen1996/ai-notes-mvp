import { Repository } from "@server/tables/repository.ts";
import { Workflow } from "@server/operations/meeting-workflow.ts";
import { MockProvider } from "@server/infra/mock-note-provider.ts";
import { AppError } from "@server/utils/errors.ts";
import { assert, equal, rejects } from "@server/utils/test-helpers.ts";

Deno.test("three credits are reserved atomically across concurrent requests; examples and users are independent", async () => {
  const dir = await Deno.makeTempDir();
  const root = new Repository(`${dir}/quota.sqlite`);
  const mock = new MockProvider(0);
  let calls = 0;
  const provider = {
    transcribe: (...args: Parameters<typeof mock.transcribe>) => {
      calls++;
      return mock.transcribe(...args);
    },
    summarize: mock.summarize.bind(mock),
  };
  const alice = new Workflow(root.forUser("alice"), {
    mock,
    assemblyai: provider,
  }, "assemblyai");
  const bob = new Workflow(
    root.forUser("bob"),
    { mock, assemblyai: provider },
    "assemblyai",
  );
  try {
    const attempts = await Promise.allSettled(
      Array.from({ length: 9 }, () =>
        alice.create({
          title: "Recording",
          source: "upload",
          consent: true,
          audioPath: "/test",
        })),
    );
    equal(attempts.filter((result) => result.status === "fulfilled").length, 3);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        assert(attempt.reason instanceof AppError);
        equal(attempt.reason.code, "AI_QUOTA_EXHAUSTED");
      }
    }
    await alice.idle();
    equal(calls, 3);
    equal(await alice.repo.getUsage(), { limit: 3, used: 3, remaining: 0 });
    await alice.create({
      title: "Free example",
      source: "demo",
      consent: true,
    });
    await alice.idle();
    equal(calls, 3);
    equal((await alice.repo.getUsage()).used, 3);
    await bob.create({
      title: "Bob recording",
      source: "upload",
      consent: true,
      audioPath: "/test",
    });
    await bob.idle();
    equal((await bob.repo.getUsage()).remaining, 2);
  } finally {
    await alice.idle();
    await bob.idle();
    await root.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("failed attempts and manual retries use credits; deleting and reopening do not restore them", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/quota.sqlite`;
  let root = new Repository(path);
  const mock = new MockProvider(0);
  let calls = 0;
  const failing = {
    transcribe: () => {
      calls++;
      return Promise.reject(new Error("Provider unavailable"));
    },
    summarize: mock.summarize.bind(mock),
  };
  const workflow = new Workflow(
    root.forUser("alice"),
    { mock, assemblyai: failing },
    "assemblyai",
    { remove: () => Promise.resolve() },
  );
  try {
    const meeting = await workflow.create({
      title: "Recording",
      source: "upload",
      consent: true,
      audioPath: "/test",
    });
    await workflow.idle();
    await workflow.retry(meeting.id);
    await workflow.idle();
    await workflow.retry(meeting.id);
    await workflow.idle();
    await rejects(() => workflow.retry(meeting.id), "used all 3");
    equal(calls, 3);
    await workflow.delete(meeting.id);
    equal(await workflow.repo.listMeetings(), []);
    equal((await workflow.repo.getUsage()).remaining, 0);
    await root.close();
    root = new Repository(path);
    equal(await root.forUser("alice").getUsage(), {
      limit: 3,
      used: 3,
      remaining: 0,
    });
  } finally {
    await workflow.idle();
    await root.close();
    await Deno.remove(dir, { recursive: true });
  }
});
