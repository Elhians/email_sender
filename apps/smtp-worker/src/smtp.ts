import nodemailer from "nodemailer";
import { z } from "zod";

const smtpConfigSchema = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().email(),
});

export type SmtpConfig = z.infer<typeof smtpConfigSchema>;

export function loadSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  return smtpConfigSchema.parse(env);
}

export function createTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });
}
