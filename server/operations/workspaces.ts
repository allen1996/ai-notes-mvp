import { Repository } from "@server/tables/repository.ts";
import { Workflow } from "@server/operations/meeting-workflow.ts";
import { seed } from "@server/operations/seed.ts";
import type { NoteProvider } from "@server/models/note-provider.ts";
import type { AudioStorage } from "@server/infra/audio-storage.ts";

/** One workflow per authenticated user keeps recovery and in-flight jobs scoped. */
export class Workspaces {
  private workspaces = new Map<string, Promise<Workflow>>();
  constructor(
    private repo: Repository,
    private providers: { mock: NoteProvider; assemblyai: NoteProvider },
    readonly aiProvider: "mock" | "assemblyai",
    private seedDemo: boolean,
    private audio?: Pick<AudioStorage, "remove">,
  ) {}
  get(userId: string): Promise<Workflow> {
    const existing = this.workspaces.get(userId);
    if (existing) return existing;
    const workspace = this.initialize(userId).catch((error) => {
      this.workspaces.delete(userId);
      throw error;
    });
    this.workspaces.set(userId, workspace);
    return workspace;
  }
  private async initialize(userId: string) {
    const repo = this.repo.forUser(userId);
    if (this.seedDemo) await seed(repo);
    const workflow = new Workflow(
      repo,
      this.providers,
      this.aiProvider,
      this.audio,
    );
    await workflow.resume();
    return workflow;
  }
  async resume() {
    for (const userId of await this.repo.listUserIds()) await this.get(userId);
  }
  async idle() {
    for (const workspace of this.workspaces.values()) {
      await (await workspace).idle();
    }
  }
}
