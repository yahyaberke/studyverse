import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().optional().transform((v) => v || undefined),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool,
  MAIL_TRANSPORT: z.enum(['none', 'console', 'smtp']).default('none'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('StudyVerse <no-reply@example.com>'),
  SESSION_STALE_SECONDS: z.coerce.number().int().min(60).default(600),
  SESSION_AUTO_FINISH_HOURS: z.coerce.number().positive().default(12),
  /** Disable rate limiting (tests only) */
  RATE_LIMIT_DISABLED: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

const env = parsed.data;
if (env.NODE_ENV === 'production') {
  if (env.MAIL_TRANSPORT === 'console') {
    console.error('❌ MAIL_TRANSPORT=console is not allowed in production');
    process.exit(1);
  }
  if (!env.COOKIE_SECURE) console.warn('⚠️  COOKIE_SECURE is false in production; cookies will not be Secure.');
}
if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
  console.error('❌ MAIL_TRANSPORT=smtp requires SMTP_HOST');
  process.exit(1);
}

export const config = {
  ...env,
  clientOrigins: env.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  mailEnabled: env.MAIL_TRANSPORT !== 'none',
  isProd: env.NODE_ENV === 'production',
};
