# Deployment (Vercel + Supabase, the course stack)

1. **Database:** create a Supabase project. Copy the *Session pooler* connection string (port 5432) into `DATABASE_URL`, with `?sslmode=require`.
2. **Migrate and create the admin** from your machine:
   ```bash
   DATABASE_URL="postgres://…supabase…" npm run db:migrate
   DATABASE_URL="postgres://…" ADMIN_EMAIL=nikhil@… ADMIN_PASSWORD='long-password' npm run db:seed
   ```
3. **Vercel:** import the GitHub repo. Framework preset Next.js. Add env vars from `.env.example`: `APP_ENV=production`, `APP_BASE_URL=https://<project>.vercel.app`, `DATABASE_URL`, `SESSION_SECRET` (new random value), `CRON_SECRET`, and Telegram/VaaniYantra values when ready. Keep `VOICE_PROVIDER=mock` until VaaniYantra is set up.
4. `vercel.json` schedules `/api/jobs/reprocess` once a day (Hobby plans allow daily crons only; Vercel sends `Authorization: Bearer $CRON_SECRET`). On Pro, change it to `*/15 * * * *`. Failed events can also be re-processed any time by calling the endpoint with the secret.
5. Deploy, then open `/api/health` (expect `"database":"ok"`), sign in, run a simulator scenario.
6. Follow `docs/vaaniyantra.md` → "Going live".

## Backups and restore
- Supabase takes daily backups on paid plans. Also export before risky changes:
  `pg_dump "$DATABASE_URL" --no-owner -Fc -f backups/aangan-$(date +%F).dump`
- Restore into an empty database: `pg_restore --no-owner -d "$TARGET_DATABASE_URL" backups/aangan-YYYY-MM-DD.dump`
- `backups/` is git-ignored: dumps contain customer data.

## Schema changes
Edit `src/lib/db/schema.ts` → `npm run db:generate` → commit the new file in `drizzle/` → `npm run db:migrate` against each environment.
