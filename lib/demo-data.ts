import type { SampleVerification } from "@/types/verification";
export const demoVerifications: SampleVerification[] = [
  {
    source: "sample",
    id: "SP-1042",
    title: "Lagos–Ibadan expressway",
    locationDescription: "Berger → Mowe, Ogun",
    status: "In progress",
    requested: "12 min ago",
    budget: 25,
    question:
      "Check traffic flow, road surface, and any obstructions on the northbound carriageway before dispatch.",
  },
  {
    source: "sample",
    id: "SP-1041",
    title: "Apapa port access road",
    locationDescription: "Apapa, Lagos",
    status: "Awaiting review",
    requested: "38 min ago",
    budget: 18,
    question:
      "Verify truck access and queue conditions at the port approach. Demo evidence review is reserved for a later phase.",
  },
  {
    source: "sample",
    id: "SP-1040",
    title: "Third Mainland Bridge",
    locationDescription: "Oworonshoki → Lagos Island",
    status: "Completed",
    requested: "1 hr ago",
    budget: 20,
    question:
      "Check southbound road conditions and visibility. This is a representative completed request, not a verified real-world report.",
  },
  {
    source: "sample",
    id: "SP-1039",
    title: "Lekki–Epe expressway",
    locationDescription: "Ajah, Lagos",
    status: "Planning",
    requested: "2 hrs ago",
    budget: 22,
    question:
      "Check for flooding and roadworks around Ajah before the next delivery run.",
  },
];
