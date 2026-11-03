import {
  demoNotes,
  demoTranscript,
  demoUtterances,
} from "@lib/fixtures/demo.ts";
import type { Meeting } from "@lib/types/meeting.ts";
import { Repository } from "@server/tables/repository.ts";

export async function seed(repo: Repository) {
  if (await repo.getMeta("seeded")) return;
  const matters = [
    {
      id: "mitchell",
      reference: "MAT-1042",
      name: "Mitchell · Property purchase",
      client: "Sarah Mitchell",
    },
    {
      id: "harbour",
      reference: "MAT-1038",
      name: "Harbour Studio · Commercial lease",
      client: "Harbour Studio Ltd",
    },
    {
      id: "thompson",
      reference: "MAT-1031",
      name: "Thompson · Estate planning",
      client: "James Thompson",
    },
  ];
  for (const matter of matters) {
    if (!await repo.getMatter(matter.id)) await repo.createMatter(matter);
  }
  const now = Date.now();
  const base: Meeting = {
    id: "demo-mitchell",
    title: "First home, next chapter",
    status: "ready",
    source: "demo",
    provider: "mock",
    createdAt: new Date(now - 30 * 60000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    consentAt: new Date(now).toISOString(),
    duration: 227,
    matterId: "mitchell",
    notes: structuredClone(demoNotes),
    personalNotes: "",
    utterances: demoUtterances,
    transcript: demoTranscript,
  };
  await repo.createMeeting(base);
  await repo.createMeeting({
    ...base,
    id: "demo-harbour",
    title: "A new space for Harbour Studio",
    matterId: "harbour",
    duration: 842,
    createdAt: new Date(now - 4 * 3600000).toISOString(),
    transcript:
      "Speaker A: We will review the draft lease once it arrives.\n\nSpeaker B: I will ask the agent to send it through.",
    utterances: [{
      speaker: "A",
      start: 0,
      end: 5000,
      text: "We will review the draft lease once it arrives.",
    }, {
      speaker: "B",
      start: 6000,
      end: 11000,
      text: "I will ask the agent to send it through.",
    }],
    notes: {
      summary:
        "An introductory discussion about a potential commercial lease for Harbour Studio. The draft lease is still outstanding, so no terms were reviewed or agreed.",
      keyPoints: [
        "The draft lease has not yet been received.",
        "A review can begin once the agent supplies the document.",
      ],
      actions: [{
        id: "lease",
        text: "Ask the agent to send the draft lease",
        owner: "Client",
        done: false,
      }],
    },
  });
  await repo.createMeeting({
    ...base,
    id: "demo-thompson",
    title: "Planning ahead with James",
    matterId: "thompson",
    duration: 617,
    createdAt: new Date(now - 26 * 3600000).toISOString(),
    transcript:
      "Speaker A: Please bring a list of your assets and your current will.\n\nSpeaker B: I will gather those before our next meeting.",
    utterances: [{
      speaker: "A",
      start: 0,
      end: 5000,
      text: "Please bring a list of your assets and your current will.",
    }, {
      speaker: "B",
      start: 6000,
      end: 11000,
      text: "I will gather those before our next meeting.",
    }],
    notes: {
      summary:
        "James discussed preparing for an estate planning review. He will gather an asset list and his current will before the next meeting. No changes to his estate plan were decided.",
      keyPoints: [
        "An asset list and the existing will are needed for the next discussion.",
        "No legal documents were changed during this meeting.",
      ],
      actions: [{
        id: "assets",
        text: "Gather the asset list and current will",
        owner: "James",
        done: true,
      }],
    },
  });
  await repo.setMeta("seeded", "true");
}
