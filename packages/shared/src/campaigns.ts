import { z } from "zod";

export const recipientSchema = z.object({
  email: z.string().email(),
  mergeData: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export const campaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "queued",
  "sending",
  "completed",
  "cancel_requested",
  "cancelled",
  "failed",
]);

export const recipientStatusSchema = z.enum([
  "pending",
  "queued",
  "sending",
  "sent",
  "failed",
  "cancelled",
]);

export const campaignModeSchema = z.enum(["send_now", "schedule"]);

export const createCampaignSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(200),
    htmlBody: z.string().trim().min(1),
    recipients: z.array(recipientSchema).min(1),
    mode: campaignModeSchema,
    scheduledAt: z.string().datetime().nullable(),
  })
  .superRefine((value, context) => {
    if (value.mode === "schedule" && !value.scheduledAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scheduledAt is required when mode is schedule",
        path: ["scheduledAt"],
      });
    }

    if (value.mode === "send_now" && value.scheduledAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scheduledAt must be empty when mode is send_now",
        path: ["scheduledAt"],
      });
    }
  });

export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type Recipient = z.infer<typeof recipientSchema>;
export type RecipientStatus = z.infer<typeof recipientStatusSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
