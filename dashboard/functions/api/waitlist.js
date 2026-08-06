// Cloudflare Pages Function: POST /api/waitlist
//
// Holds the Supabase SERVICE key. This is the only server-side code in the
// dashboard. The anon key in the browser bundle has no access to this table
// (see migration 010), so every write must come through here.

const ALLOWED = {
  lead_source: ['Paid Ads', 'Organic', 'Both'],
  response_speed: ['Less than 5 minutes', 'Less than 1 hour', 'Same day', 'Next day or later'],
  has_dm_script: [
    'Yes, we have one that works',
    'Yes, but it needs improvement',
    'No, we dont have one yet'
  ],
  has_booking_system: ['Yes', 'No (I need help setting this up)'],
  current_crm: ['GoHighLevel', 'HubSpot', 'SalesForce', 'Close.io', 'Airtable', 'Google Sheets', 'None yet'],
  team_size: ['Just me', '1 setter', '2-3 setters', '4+ setters']
};

const BOTTLENECKS = [
  'I cant keep up with DMs/volume',
  "My messages don't convert into bookings",
  'Too many unqualified leads',
  "Follow up isn't consistent",
  'I need a better system/structure'
];

const REQUIRED_TEXT = [
  'first_name', 'last_name', 'email', 'instagram_handle',
  'what_you_sell', 'main_offer_price', 'inbound_leads_per_day',
  'booked_calls_per_week', 'avg_monthly_revenue', 'failed_dm_example'
];

const MAX_LEN = 5000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function clean(v) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, MAX_LEN);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Diagnostics
// Cloudflare secrets are write-only: once set they cannot be read back. During
// setup, a clipboard slip nearly stored a Supabase JWT in TURNSTILE_SECRET_KEY.
// This endpoint reports PRESENCE and FORMAT only, never values. Knowing that a
// secret is configured is not exploitable; knowing it is MISSING or malformed
// saves hours of debugging a silent failure.
export async function onRequestGet(context) {
  const { env } = context;
  const t = env.TURNSTILE_SECRET_KEY || '';
  const s = env.SUPABASE_SERVICE_KEY || '';
  return json(200, {
    ok: true,
    checks: {
      supabase_url_set: Boolean(env.SUPABASE_URL),
      supabase_url_is_prod: (env.SUPABASE_URL || '').includes('rydkwsjwlgnivlwlvqku'),
      service_key_set: Boolean(s),
      service_key_looks_like_jwt: s.startsWith('eyJ'),
      turnstile_secret_set: Boolean(t),
      turnstile_secret_format_ok: t.startsWith('0x'),
      resend_key_set: Boolean(env.RESEND_API_KEY),
      notify_email_set: Boolean(env.NELLA_NOTIFY_EMAIL)
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Fail loudly on misconfiguration rather than silently dropping applications.
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'TURNSTILE_SECRET_KEY']) {
    if (!env[k]) {
      console.error(`[waitlist] missing env: ${k}`);
      return json(500, { error: 'Server not configured. Please try again later.' });
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  // Honeypot. A real person never fills a hidden field. Return 200 so bots
  // think they succeeded and do not retry with a different strategy.
  if (clean(body.company_website)) {
    return json(200, { ok: true });
  }

  // Turnstile
  // Verified server-side. A client-side-only check is decorative.
  const token = clean(body.turnstile_token);
  if (!token) return json(400, { error: 'Please complete the verification.' });

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const tsForm = new FormData();
  tsForm.append('secret', env.TURNSTILE_SECRET_KEY);
  tsForm.append('response', token);
  if (ip) tsForm.append('remoteip', ip);

  let tsOk = false;
  try {
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: tsForm
    });
    const tsJson = await tsRes.json();
    tsOk = tsJson.success === true;
    if (!tsOk) console.warn('[waitlist] turnstile rejected:', JSON.stringify(tsJson['error-codes'] || []));
  } catch (e) {
    console.error('[waitlist] turnstile threw:', e.message);
    return json(503, { error: 'Verification unavailable. Please try again.' });
  }
  if (!tsOk) return json(403, { error: 'Verification failed. Please refresh and try again.' });

  // Validate
  const row = {};
  for (const f of REQUIRED_TEXT) {
    const v = clean(body[f]);
    if (!v) return json(400, { error: `Missing required field: ${f}` });
    row[f] = v;
  }
  if (!EMAIL_RE.test(row.email)) return json(400, { error: 'Please enter a valid email address.' });

  row.business_name = clean(body.business_name) || null;
  row.anything_else = clean(body.anything_else) || null;

  // Strip a leading @ so handles are stored consistently.
  row.instagram_handle = row.instagram_handle.replace(/^@+/, '');

  for (const [field, options] of Object.entries(ALLOWED)) {
    const v = clean(body[field]);
    const optional = field === 'has_booking_system';
    if (!v) {
      if (optional) { row[field] = null; continue; }
      return json(400, { error: `Missing required field: ${field}` });
    }
    // Must match the DB check constraints exactly or the insert fails.
    if (!options.includes(v)) return json(400, { error: `Invalid value for ${field}` });
    row[field] = v;
  }

  const picked = Array.isArray(body.bottlenecks) ? body.bottlenecks : [];
  row.bottlenecks = picked.filter(b => BOTTLENECKS.includes(b));
  if (row.bottlenecks.length === 0) {
    return json(400, { error: 'Please select at least one bottleneck.' });
  }

  row.ip_hash = ip ? await sha256(ip) : null;
  row.user_agent = clean(request.headers.get('User-Agent') || '') || null;

  // Insert
  // AWAITED on purpose. We must know this succeeded before telling the applicant
  // they are on the list. Do not move this to waitUntil.
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/waitlist_applications`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error(`[waitlist] supabase insert failed ${res.status}: ${txt}`);
      return json(500, { error: 'Could not save your application. Please try again.' });
    }
  } catch (e) {
    console.error('[waitlist] supabase threw:', e.message);
    return json(500, { error: 'Could not save your application. Please try again.' });
  }

  // Notify
  // NOT awaited. The application is already saved. A Resend outage must never
  // show the applicant an error for something that actually worked.
  if (env.RESEND_API_KEY && env.NELLA_NOTIFY_EMAIL) {
    const lines = [
      `${row.first_name} ${row.last_name} applied to the MU AI waitlist.`,
      '',
      `Email: ${row.email}`,
      `Instagram: @${row.instagram_handle}`,
      `Business: ${row.business_name || '(not given)'}`,
      '',
      `Sells: ${row.what_you_sell}`,
      `Offer price: ${row.main_offer_price}`,
      `Monthly revenue: ${row.avg_monthly_revenue}`,
      `Leads/day: ${row.inbound_leads_per_day}`,
      `Booked calls/week: ${row.booked_calls_per_week}`,
      `Lead source: ${row.lead_source}`,
      `Response speed: ${row.response_speed}`,
      `Team: ${row.team_size}`,
      `CRM: ${row.current_crm}`,
      `DM script: ${row.has_dm_script}`,
      `Booking system: ${row.has_booking_system || '(not answered)'}`,
      `Bottlenecks: ${row.bottlenecks.join(', ')}`,
      '',
      'Failed DM example:',
      row.failed_dm_example,
      '',
      'Anything else:',
      row.anything_else || '(nothing)'
    ];
    context.waitUntil(
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'MU AI Waitlist <waitlist@getmu.co>',
          to: [env.NELLA_NOTIFY_EMAIL],
          reply_to: row.email,
          subject: `New waitlist application: ${row.first_name} ${row.last_name} (@${row.instagram_handle})`,
          text: lines.join('\n')
        })
      })
        .then(async r => {
          if (!r.ok) console.error(`[waitlist] resend failed ${r.status}: ${await r.text()}`);
        })
        .catch(e => console.error('[waitlist] resend threw:', e.message))
    );
  }

  return json(200, { ok: true });
}
