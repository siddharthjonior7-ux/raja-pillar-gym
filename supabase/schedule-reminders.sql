-- ONLY needed after WhatsApp Business API is connected (README step 6).
-- Run in Supabase > SQL Editor. Replace the two placeholders first.
-- YOUR_PROJECT_REF = the part before .supabase.co in your project URL
-- YOUR_CRON_SECRET = the same value you set as the CRON_SECRET function secret
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- every day at 10:00 India time (04:30 UTC): fee, overdue, expiry and renewal reminders
select cron.schedule('pillar-daily-reminders', '30 4 * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-auto',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'),
    body := '{"mode":"daily"}'::jsonb);
$$);

-- every 10 minutes: payment confirmations
select cron.schedule('pillar-payment-confirmations', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-auto',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'),
    body := '{"mode":"confirmations"}'::jsonb);
$$);
