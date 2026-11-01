# Monthly partner report (Edge Function)

Emails each advertising partner a short summary of last month: pin/listing views,
card opens, calls, website taps, directions, and offers used. Data comes from the
`partner_report` view (`0002_partners.sql`, extended in `0005_partners_v1.sql`).

A partner gets an email only if:
- `partners.contact_email` is filled in (Table Editor → partners), and
- they had at least one event that month.

## 1. Run the migration
SQL Editor → paste `supabase/migrations/0005_partners_v1.sql` → Run.

## 2. Set up Resend (email sending)
1. resend.com → add and verify your domain (e.g. `ridemadison.com`).
2. Create an API key.

## 3. Add secrets
Dashboard → Edge Functions → Secrets (or with the CLI):

```
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set REPORT_FROM="Ride Madison <partners@ridemadison.com>"
supabase secrets set REPORT_BCC=you@example.com   # optional: get a copy of each report
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically. Never put keys in code.

## 4. Deploy

```
supabase functions deploy partner-report
```

## 5. Try it without sending

```
curl -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  "https://YOUR-PROJECT.supabase.co/functions/v1/partner-report?dry_run=1"
```

Add `&month=2026-10` to pick a month. Drop `dry_run=1` to send for real.

## 6. Schedule it (1st of each month, 9 am Central)
Dashboard → Database → Extensions: enable `pg_cron` and `pg_net`. Then in the SQL Editor
(replace the two placeholders; store the key in Vault if you prefer):

```sql
select cron.schedule(
  'partner-report-monthly',
  '0 14 1 * *',  -- 14:00 UTC = 9 am CDT / 8 am CST
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/partner-report',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY')
  );
  $$
);
```

Or use Dashboard → Integrations → Cron → Create job → "Supabase Edge Function".

To stop it: `select cron.unschedule('partner-report-monthly');`
