// Ride Madison: welcome email (Supabase Edge Function, Deno).
//
// The app calls this once, right after a rider's first sign-in (email, Apple or
// Google), with the rider's own session token and their app language. The function:
//   1. checks the token and reads the rider's email + name,
//   2. skips if profiles.welcomed_at is already set (never sends twice),
//   3. sends the branded welcome email through Resend,
//   4. stamps profiles.welcomed_at and profiles.language.
// Add ?dry_run=1 to get the email back as JSON without sending (still needs a valid token).
//
// Secrets (Dashboard → Edge Functions → Secrets; never in code):
//   RESEND_API_KEY   Resend API key
//   WELCOME_FROM     e.g. "Ride Madison <hello@ridemadison.com>" (a domain verified in Resend)
//   WELCOME_REPLY_TO optional: where replies go, e.g. your own inbox
//   WELCOME_LOGO_URL optional: public URL of assets/email/logo.png (else a text wordmark)
//   MAILING_ADDRESS  optional: postal address for the footer
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import { welcomeEmail, type WelcomeLang } from './template.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  // Newer projects use sb_secret_/sb_publishable_ keys; older ones JWT keys. Support both.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('WELCOME_FROM');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server not configured' }, 500);

  // 1. Who is calling? (their own session token)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401);
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: req.headers.get('apikey') || anonKey || serviceKey, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) return json({ error: 'Not signed in' }, 401);
  const user = (await userRes.json()) as { id: string; email?: string | null };
  if (!user.email) return json({ skipped: 'no email' });

  const body = (await req.json().catch(() => ({}))) as { lang?: string };
  const lang: WelcomeLang = body.lang === 'es' ? 'es' : 'en';
  // sb_secret_ keys go only in the apikey header; legacy JWT keys also as a Bearer token.
  const admin: Record<string, string> = serviceKey.startsWith('sb_')
    ? { apikey: serviceKey, 'Content-Type': 'application/json' }
    : { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  // 2. Already welcomed?
  const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=full_name,welcomed_at`, { headers: admin });
  const [profile] = (profRes.ok ? await profRes.json() : []) as { full_name: string | null; welcomed_at: string | null }[];
  if (profile?.welcomed_at) return json({ skipped: 'already welcomed' });

  const mail = welcomeEmail({
    name: profile?.full_name,
    lang,
    logoUrl: Deno.env.get('WELCOME_LOGO_URL') ?? null,
    appUrl: 'https://ridemadison.com',
    mailingAddress: Deno.env.get('MAILING_ADDRESS') ?? null,
  });
  if (new URL(req.url).searchParams.get('dry_run') === '1') return json({ to: user.email, ...mail });
  if (!resendKey || !from) return json({ error: 'Email not configured' }, 500);

  // Claim the welcome first (only if still unset) so two quick calls can't send twice.
  const claim = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&welcomed_at=is.null`, {
    method: 'PATCH',
    headers: { ...admin, Prefer: 'return=representation' },
    body: JSON.stringify({ welcomed_at: new Date().toISOString(), language: lang }),
  });
  const claimed = claim.ok ? ((await claim.json()) as unknown[]) : [];
  if (!claimed.length) return json({ skipped: 'already welcomed' });

  // 3. Send.
  const replyTo = Deno.env.get('WELCOME_REPLY_TO');
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [user.email], subject: mail.subject, html: mail.html, text: mail.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!sent.ok) {
    // Release the claim so the app can try again next time.
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ welcomed_at: null }) });
    return json({ error: 'Send failed', status: sent.status }, 502);
  }
  return json({ sent: true });
});
