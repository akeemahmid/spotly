import { z } from "zod";
import { acceptedPlanSchema } from "./plan";

export const categoryLabels = {
  road_conditions: "Road conditions",
  route_access: "Route access",
  site_access: "Site access",
  other: "Other",
} as const;
export const evidenceLabels = {
  photos: "Photos of the location",
  video: "Short video",
  written_observation: "Written observation",
} as const;
export const coordinatesSchema = z.object({
  latitude: z
    .number({ error: "Enter a latitude." })
    .min(-90, "Latitude must be between −90 and 90.")
    .max(90, "Latitude must be between −90 and 90."),
  longitude: z
    .number({ error: "Enter a longitude." })
    .min(-180, "Longitude must be between −180 and 180.")
    .max(180, "Longitude must be between −180 and 180."),
});
export const verificationInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Enter a verification title.")
      .max(100, "Use 100 characters or fewer."),
    question: z
      .string()
      .trim()
      .min(1, "Enter the question you need answered.")
      .max(2000, "Use 2,000 characters or fewer."),
    category: z.enum(
      ["road_conditions", "route_access", "site_access", "other"],
      { error: "Choose a category." },
    ),
    locationDescription: z
      .string()
      .trim()
      .min(1, "Describe the location.")
      .max(300, "Use 300 characters or fewer."),
    coordinates: coordinatesSchema,
    evidenceRequirements: z
      .array(z.enum(["photos", "video", "written_observation"]))
      .min(1, "Choose at least one evidence requirement.")
      .max(3)
      .refine(
        (values) => new Set(values).size === values.length,
        "Choose each evidence requirement only once.",
      ),
    expiresAt: z.iso.datetime({
      offset: true,
      error: "Choose a valid expiration date and time.",
    }),
    budget: z
      .number({ error: "Explicitly enter a maximum budget." })
      .min(0, "Budget cannot be negative.")
      .max(1000000, "Use a budget of $1,000,000 or less.")
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
        "Use no more than two decimal places.",
      ),
  })
  .strict();

// Future expiration is a creation-time rule. Saved drafts remain readable after expiry.
export function validateNewVerification(input: unknown, now = Date.now()) {
  return verificationInputSchema
    .superRefine((value, context) => {
      if (Date.parse(value.expiresAt) <= now)
        context.addIssue({
          code: "custom",
          path: ["expiresAt"],
          message: "Expiration must be in the future.",
        });
    })
    .safeParse(input);
}
export const storedDraftSchema = verificationInputSchema
  .extend({
    id: z
      .string()
      .regex(
        /^SP-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    source: z.literal("local"),
    status: z.literal("draft"),
    createdAt: z.iso.datetime({ offset: true }),
    acceptedPlan: acceptedPlanSchema.optional(),
  })
  .strict()
  .refine(
    (task) => Date.parse(task.expiresAt) > Date.parse(task.createdAt),
    "Expiration must follow creation.",
  );
