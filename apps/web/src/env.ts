import { z } from "zod";

const webEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

let cachedEnv: WebEnv | null = null;

export function loadWebEnv(): WebEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = webEnvSchema.safeParse(import.meta.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid web environment variables: ${details}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
