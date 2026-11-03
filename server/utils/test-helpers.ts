import { Repository } from "@server/tables/repository.ts";
import { Workflow } from "@server/operations/meeting-workflow.ts";
import { MockProvider } from "@server/infra/mock-note-provider.ts";
import type { NoteProvider } from "@server/models/note-provider.ts";
export { assert, equal, rejects } from "@lib/testing/assert.ts";
export function fixture(provider: NoteProvider = new MockProvider(0)) {
  const dir = Deno.makeTempDirSync();
  const repo = new Repository(`${dir}/test.sqlite`);
  const workflow = new Workflow(
    repo,
    { mock: provider, assemblyai: provider },
    "mock",
  );
  return {
    repo,
    workflow,
    close: async () => {
      await workflow.idle();
      await repo.close();
      await Deno.remove(dir, { recursive: true });
    },
  };
}
export async function readyMeeting(workflow: Workflow) {
  const meeting = await workflow.create({
    title: "Client meeting",
    source: "demo",
    consent: true,
  });
  await workflow.idle();
  return workflow.repo.getMeeting(meeting.id);
}
