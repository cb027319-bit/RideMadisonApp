// Ride Madison: monthly partner report (Supabase Edge Function, Deno).
//
// For last month (or ?month=YYYY-MM), reads public.partner_report and emails each
// partner's contact_email a short summary through Resend. Add ?dry_run=1 to see the
// emails as JSON without sending. Schedule it monthly: see README.md in this folder.
//
// Secrets (Dashboard → Edge Functions → Secrets; never in code):
//   RESEND_API_KEY   Resend API key
//   REPORT_FROM      e.g. "Ride Madison <partners@ridemadison.com>" (a domain verified in Resend)
//   REPORT_BCC       optional: your own address, to get a copy of every report
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

// Minimal Deno typing so the app's TypeScript check (which also sees this file) passes.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

export interface ReportRow {
  partner_id: string;
  name: string;
  tier: string;
  month: string; // 'YYYY-MM-01'
  impressions: number;
  card_opens: number;
  calls: number;
  website_taps: number;
  directions: number;
  offers_used: number | null;
  contact_name: string | null;
  contact_email: string | null;
}

/** First day of the previous month (UTC), as 'YYYY-MM-01'. */
export function lastMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
}

const monthName = (m: string) =>
  new Date(`${m}T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function buildEmail(r: ReportRow): { subject: string; text: string; html: string } {
  const month = monthName(r.month);
  const lines: [string, number][] = [
    ['Times your pin or listing was seen', Number(r.impressions) || 0],
    ['Riders who opened your card', Number(r.card_opens) || 0],
    ['Calls', Number(r.calls) || 0],
    ['Website taps', Number(r.website_taps) || 0],
    ['Directions and routes to you', Number(r.directions) || 0],
    ['Offers shown at your counter', Number(r.offers_used) || 0],
  ];
  const hello = r.contact_name ? `Hi ${r.contact_name},` : 'Hi,';
  const subject = `${r.name}: your Ride Madison results for ${month}`;
  const text = [
    hello,
    '',
    `Here's how ${r.name} did on Ride Madison in ${month}:`,
    '',
    ...lines.map(([k, v]) => `  ${k}: ${v.toLocaleString('en-US')}`),
    '',
    'Questions or changes to your listing? Just reply to this email.',
    '',
    'Thanks for supporting Madison riders,',
    'Ride Madison',
  ].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;color:#14213D;max-width:520px">
<p>${esc(hello)}</p>
<p>Here's how <strong>${esc(r.name)}</strong> did on Ride Madison in ${esc(month)}:</p>
<table style="border-collapse:collapse;width:100%">
${lines.map(([k, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E9E4DA">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #E9E4DA;text-align:right;font-weight:700">${v.toLocaleString('en-US')}</td></tr>`).join('\n')}
</table>
<p>Questions or changes to your listing? Just reply to this email.</p>
<p>Thanks for supporting Madison riders,<br>Ride Madison</p>
</div>`;
  return { subject, text, html };
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('REPORT_FROM');
  const bcc = Deno.env.get('REPORT_BCC');
  const dryRun = url.searchParams.get('dry_run') === '1';

  // Only callers holding the service role key (the scheduled job, or you) may run this.
  const auth = req.headers.get('Authorization') ?? '';
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) return json({ error: 'Not allowed' }, 401);
  if (!supabaseUrl) return json({ error: 'SUPABASE_URL is not set' }, 500);
  if (!dryRun && (!resendKey || !from)) return json({ error: 'Set the RESEND_API_KEY and REPORT_FROM secrets' }, 500);

  const param = url.searchParams.get('month');
  const month = param && /^\d{4}-\d{2}$/.test(param) ? `${param}-01` : lastMonth();

  const res = await fetch(`${supabaseUrl}/rest/v1/partner_report?select=*&month=eq.${month}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) return json({ error: `Couldn't read partner_report (${res.status})`, detail: await res.text() }, 500);
  const rows = (await res.json()) as ReportRow[];

  const results: { partner: string; to: string | null; status: string }[] = [];
  for (const r of rows) {
    if (!r.contact_email) {
      results.push({ partner: r.name, to: null, status: 'skipped: no contact_email' });
      continue;
    }
    const email = buildEmail(r);
    if (dryRun) {
      results.push({ partner: r.name, to: r.contact_email, status: `dry run: ${email.subject}` });
      continue;
    }
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [r.contact_email],
        ...(bcc ? { bcc: [bcc] } : {}),
        reply_to: 'partners@ridemadison.com',
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    results.push({ partner: r.name, to: r.contact_email, status: sent.ok ? 'sent' : `failed (${sent.status})` });
  }
  return json({ month, partners: rows.length, results });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}

if (typeof Deno !== 'undefined') Deno.serve(handler);
