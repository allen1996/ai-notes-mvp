import type { Notes, Utterance } from "@lib/types/meeting.ts";

export const demoNotes: Notes = {
  summary:
    "Sarah Mitchell discussed the purchase of 24 Kauri Lane, a first home with an agreed price of $845,000. The agreement is conditional on finance and a satisfactory building inspection. Sarah would like to settle in six weeks. The next step is to review the agreement and confirm the condition dates before she signs.",
  keyPoints: [
    "Purchase price of $845,000, with a 10% deposit payable when the agreement becomes unconditional.",
    "Finance approval and a building inspection are outstanding conditions. Exact deadlines need to be checked against the agreement.",
    "Sarah’s preferred settlement is six weeks from signing, subject to the vendor’s agreement.",
    "Scope discussed: agreement review, due diligence, and settlement. A written engagement letter will follow.",
  ],
  actions: [
    {
      id: "review",
      text:
        "Review the sale and purchase agreement and confirm condition dates",
      owner: "Lawyer",
      done: false,
    },
    {
      id: "inspection",
      text: "Arrange a building inspection and forward the report",
      owner: "Sarah",
      done: false,
    },
    {
      id: "engagement",
      text: "Send the engagement letter and initial document checklist",
      owner: "Lawyer",
      done: false,
    },
  ],
};
export const demoUtterances: Utterance[] = [
  {
    speaker: "A",
    start: 0,
    end: 14000,
    text:
      "Thanks for coming in, Sarah. Let’s start with the property and where things stand with the offer.",
  },
  {
    speaker: "B",
    start: 15000,
    end: 41000,
    text:
      "It’s 24 Kauri Lane. We have agreed on eight hundred and forty-five thousand dollars. It’s my first home, so I would really appreciate someone walking me through the agreement before I sign.",
  },
  {
    speaker: "A",
    start: 42000,
    end: 65000,
    text:
      "Of course. Is the offer conditional on finance and a building inspection?",
  },
  {
    speaker: "B",
    start: 66000,
    end: 106000,
    text:
      "Yes, both. My bank is working on the final approval. I still need to book the inspector. I think the deposit is ten percent once it goes unconditional.",
  },
  {
    speaker: "A",
    start: 107000,
    end: 151000,
    text:
      "I will check the exact condition dates in the agreement. Please arrange the inspection and send me the report. Do you have a preferred settlement date?",
  },
  {
    speaker: "B",
    start: 152000,
    end: 183000,
    text:
      "Six weeks from signing would work best for me, if the vendor agrees.",
  },
  {
    speaker: "A",
    start: 184000,
    end: 227000,
    text:
      "We can put that forward. I will review the agreement, manage the due diligence, and help with settlement. I will send an engagement letter and a checklist of documents to get started.",
  },
];
export const demoTranscript = demoUtterances.map((u) =>
  `Speaker ${u.speaker}: ${u.text}`
).join("\n\n");
