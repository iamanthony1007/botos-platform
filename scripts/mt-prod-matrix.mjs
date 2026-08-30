// scripts/mt-prod-matrix.mjs
// MT Phase 1 behavioral matrix, PRODUCTION, automated rows.
// See docs/MT-PHASE-1-PRODUCTION-RUN.md. Covers matrix rows 1-6, 9, 13, 14
// plus same-tenant control probes. Manual rows stay manual: 8 (browser walk),
// 10 (cron observation), 11 (Realtime), 12 (AcceptInvite end to end).
//
// Anthony runs this. The service key arrives via the masked prompt, never
// typed into chat, never printed:
//
//   PowerShell 5.1, from the repo root:
//     $sec = Read-Host -Prompt "Paste PRODUCTION service key" -AsSecureString
//     $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
//     $env:PROD_SUPABASE_SERVICE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
//     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
//     node scripts/mt-prod-matrix.mjs
//     Remove-Item Env:\PROD_SUPABASE_SERVICE_KEY
//     $sec = $null
//
// WHAT IT DOES, precisely:
//   - Mints one session per tier via the admin API (magiclink generate_link,
//     then verify). No passwords exist or are created. JWTs live only in this
//     process's memory and are never printed.
//   - READS other tenants' data only. The ONLY writes are to the Mu AI Demo
//     tenant: one fixture review (tester_ prefixed) created via the service
//     key, patched once by its own tenant as a control, and DELETED in
//     cleanup. One cross-tenant learnings INSERT is attempted and must be
//     REJECTED by RLS (a rejected insert writes nothing).
//   - Prints PASS/FAIL per row with counts, never token material.

const URL_ = "https://rydkwsjwlgnivlwlvqku.supabase.co";
const WORKER = "https://sales-bot.nellakuate.workers.dev";
const KEY = process.env.PROD_SUPABASE_SERVICE_KEY;
// Public anon key, same value the dashboard ships in its bundle.
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5ZGt3c2p3bGduaXZsd2x2cWt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDA1ODEsImV4cCI6MjA5MTA3NjU4MX0.8Th4ObB8I22BgbedX8_S1CAdSlAAZ3nXk8ScA7164G4";

const BOMBERS_BOT = "00000000-0000-0000-0000-000000000002";
const DEMO_BOT = "00000000-0000-0000-0000-0000000000d1";
const SUPERYOU_BOT = "45b776e3-ee4f-461d-a526-4249d18757b3";

const TIERS = {
  superadmin: "iamanthony1007@gmail.com",
  bombers_setter: "austinewebdev@gmail.com",
  demo_setter: "meta-review@getmu.co",
};

if (!KEY) {
  console.error("PROD_SUPABASE_SERVICE_KEY is not set. See the header of this file.");
  process.exit(1);
}

const svc = { "apikey": KEY, "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" };
const results = [];
function record(row, pass, detail) {
  results.push({ row, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${row}  ${detail}`);
}

async function mintSession(email) {
  const gl = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
    method: "POST", headers: svc,
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!gl.ok) throw new Error(`generate_link ${email} ${gl.status}: ${await gl.text()}`);
  const j = await gl.json();
  const tokenHash = (j.properties && j.properties.hashed_token) || j.hashed_token;
  if (!tokenHash) throw new Error(`no hashed_token in generate_link response for ${email}`);
  for (const type of ["magiclink", "email"]) {
    const v = await fetch(`${URL_}/auth/v1/verify`, {
      method: "POST",
      headers: { "apikey": ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ type, token_hash: tokenHash }),
    });
    if (v.ok) {
      const s = await v.json();
      const jwt = s.access_token || (s.session && s.session.access_token);
      if (jwt) return jwt;
    }
  }
  throw new Error(`verify failed for ${email}`);
}

function userHeaders(jwt) {
  return { "apikey": ANON, "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" };
}

async function restGet(jwt, path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: userHeaders(jwt) });
  const text = await r.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch (e) { rows = null; }
  return { status: r.status, rows: Array.isArray(rows) ? rows : null, body: text.slice(0, 120) };
}

async function main() {
  console.log("=== MT Phase 1 production matrix (automated rows) ===");
  console.log("");

  const jwts = {};
  for (const [tier, email] of Object.entries(TIERS)) {
    jwts[tier] = await mintSession(email);
    console.log(`session minted: ${tier} (${email})`);
  }
  console.log("");

  // ---- Row 1: superadmin reads across tenants -------------------------------
  {
    const bots = await restGet(jwts.superadmin, "bots?select=id&order=id");
    const ids = (bots.rows || []).map(b => b.id);
    const ok = ids.includes(BOMBERS_BOT) && ids.includes(DEMO_BOT) && ids.includes(SUPERYOU_BOT);
    record("R1 superadmin sees all bots", ok, `bots=${ids.length} of 3 expected`);
    const conv = await restGet(jwts.superadmin, "conversations?select=id&limit=1");
    record("R1 superadmin reads conversations", conv.status === 200 && (conv.rows || []).length === 1,
      `HTTP ${conv.status}, rows=${(conv.rows || []).length}`);
  }

  // ---- Row 2: Bombers setter sees Bombers only ------------------------------
  {
    const bots = await restGet(jwts.bombers_setter, "bots?select=id");
    const ids = (bots.rows || []).map(b => b.id);
    record("R2 bombers bots = exactly own bot", ids.length === 1 && ids[0] === BOMBERS_BOT, `ids=[${ids.join(",")}]`);
    const own = await restGet(jwts.bombers_setter, "conversations?select=bot_id&limit=1000");
    const distinct = [...new Set((own.rows || []).map(c => c.bot_id))];
    record("R2 bombers conversations all own-tenant",
      (own.rows || []).length > 0 && distinct.length === 1 && distinct[0] === BOMBERS_BOT,
      `rows=${(own.rows || []).length}, distinct bot_ids=${distinct.length}`);
    const sy = await restGet(jwts.bombers_setter, `conversations?select=id&bot_id=eq.${SUPERYOU_BOT}&limit=5`);
    record("R2 bombers reads SuperYOU conversations: zero", sy.status === 200 && (sy.rows || []).length === 0,
      `HTTP ${sy.status}, rows=${(sy.rows || []).length}`);
    const syr = await restGet(jwts.bombers_setter, `reviews?select=id&bot_id=eq.${SUPERYOU_BOT}&limit=5`);
    record("R2 bombers reads SuperYOU reviews: zero", syr.status === 200 && (syr.rows || []).length === 0,
      `HTTP ${syr.status}, rows=${(syr.rows || []).length}`);
  }

  // ---- Row 3: demo setter sees demo only ------------------------------------
  {
    const bots = await restGet(jwts.demo_setter, "bots?select=id");
    const ids = (bots.rows || []).map(b => b.id);
    record("R3 demo bots = exactly demo bot", ids.length === 1 && ids[0] === DEMO_BOT, `ids=[${ids.join(",")}]`);
    const bb = await restGet(jwts.demo_setter, `conversations?select=id&bot_id=eq.${BOMBERS_BOT}&limit=5`);
    record("R3 demo reads Bombers conversations: zero", bb.status === 200 && (bb.rows || []).length === 0,
      `HTTP ${bb.status}, rows=${(bb.rows || []).length} (was the full lead history pre-011)`);
    const bbr = await restGet(jwts.demo_setter, `reviews?select=id&bot_id=eq.${BOMBERS_BOT}&limit=5`);
    record("R3 demo reads Bombers reviews: zero", bbr.status === 200 && (bbr.rows || []).length === 0,
      `HTTP ${bbr.status}, rows=${(bbr.rows || []).length}`);
  }

  // ---- Fixture: one demo-tenant review, service key, torn down at the end ---
  const FIXTURE_ID = `tester_matrix_${Date.now()}`;
  {
    const r = await fetch(`${URL_}/rest/v1/reviews`, {
      method: "POST", headers: { ...svc, "Prefer": "return=representation" },
      body: JSON.stringify({
        id: FIXTURE_ID, bot_id: DEMO_BOT, customer_id: "tester_matrix",
        action_type: "reply", channel: "instagram_api", status: "pending",
        bot_messages: ["matrix fixture, deleted by cleanup"],
      }),
    });
    if (!r.ok) throw new Error(`fixture insert failed ${r.status}: ${await r.text()}`);
    console.log(`fixture review created on demo tenant: ${FIXTURE_ID}`);
  }

  // ---- Row 4: cross-tenant UPDATE affects zero rows -------------------------
  {
    const cross = await fetch(`${URL_}/rest/v1/reviews?id=eq.${FIXTURE_ID}`, {
      method: "PATCH", headers: { ...userHeaders(jwts.bombers_setter), "Prefer": "return=representation" },
      body: JSON.stringify({ internal_notes: "cross-tenant probe, must not land" }),
    });
    const crossRows = cross.ok ? await cross.json() : [];
    record("R4 bombers UPDATE demo review: zero rows", cross.status === 200 && crossRows.length === 0,
      `HTTP ${cross.status}, affected=${crossRows.length}`);
    const own = await fetch(`${URL_}/rest/v1/reviews?id=eq.${FIXTURE_ID}`, {
      method: "PATCH", headers: { ...userHeaders(jwts.demo_setter), "Prefer": "return=representation" },
      body: JSON.stringify({ internal_notes: "same-tenant control probe" }),
    });
    const ownRows = own.ok ? await own.json() : [];
    record("R4 control: demo UPDATE own review: one row", own.status === 200 && ownRows.length === 1,
      `HTTP ${own.status}, affected=${ownRows.length}`);
  }

  // ---- Row 5: cross-tenant INSERT rejected ----------------------------------
  {
    const r = await fetch(`${URL_}/rest/v1/learnings`, {
      method: "POST", headers: userHeaders(jwts.bombers_setter),
      body: JSON.stringify({
        bot_id: DEMO_BOT, customer_id: "tester_matrix",
        corrected_reply: "cross-tenant probe, must be rejected", source: "matrix-probe",
      }),
    });
    const body = await r.text();
    record("R5 bombers INSERT into demo learnings: denied",
      r.status === 401 || r.status === 403 || body.includes("42501"),
      `HTTP ${r.status} ${body.slice(0, 60)}`);
  }

  // ---- Row 6: locked tables stay locked, per tier ---------------------------
  for (const tier of Object.keys(TIERS)) {
    const ca = await restGet(jwts[tier], "connected_accounts?select=id&limit=1");
    const dd = await restGet(jwts[tier], "data_deletion_requests?select=id&limit=1");
    const wl = await restGet(jwts[tier], "waitlist_applications?select=id&limit=1");
    const caOk = ca.status === 200 && (ca.rows || []).length === 0;
    const ddOk = dd.status === 401 || dd.status === 403;
    const wlOk = wl.status === 401 || wl.status === 403;
    record(`R6 ${tier}: connected_accounts empty, ddr+waitlist denied`, caOk && ddOk && wlOk,
      `ca=${ca.status}/${(ca.rows || []).length} ddr=${dd.status} wl=${wl.status}`);
  }

  // ---- Row 9: /meta/send tenant gate ----------------------------------------
  {
    const cross = await fetch(`${WORKER}/meta/send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${jwts.bombers_setter}`, "Content-Type": "application/json" },
      body: JSON.stringify({ review_id: FIXTURE_ID }),
    });
    record("R9 /meta/send cross-tenant: 403", cross.status === 403, `HTTP ${cross.status}`);
    const own = await fetch(`${WORKER}/meta/send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${jwts.demo_setter}`, "Content-Type": "application/json" },
      body: JSON.stringify({ review_id: FIXTURE_ID }),
    });
    const ownBody = await own.text();
    // Same tenant passes the gate, then dies on the status machine (fixture is
    // pending, not approved). 400 "review not approved" is the expected proof
    // that the tenant gate is what 403'd above, and nothing was sent.
    record("R9 control: same-tenant passes gate, blocked by status (400)",
      own.status === 400 && ownBody.includes("not approved"), `HTTP ${own.status} ${ownBody.slice(0, 60)}`);
  }

  // ---- Rows 13/14: oauth trio and connection-status -------------------------
  {
    const crossInit = await fetch(`${WORKER}/meta/oauth/init`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${jwts.bombers_setter}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: DEMO_BOT }),
    });
    record("R13 oauth/init cross-tenant: 403", crossInit.status === 403, `HTTP ${crossInit.status}`);

    const ownInit = await fetch(`${WORKER}/meta/oauth/init`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${jwts.bombers_setter}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: BOMBERS_BOT }),
    });
    const initJson = ownInit.ok ? await ownInit.json() : {};
    record("R13 oauth/init same-tenant: 200 with url", ownInit.status === 200 && !!initJson.url,
      `HTTP ${ownInit.status}`);

    if (initJson.url) {
      const first = await fetch(initJson.url, { redirect: "manual" });
      record("R13 oauth/start first use: 302 to Instagram", first.status === 302,
        `HTTP ${first.status}`);
      const replay = await fetch(initJson.url, { redirect: "manual" });
      record("R13 oauth/start replay: 403", replay.status === 403, `HTTP ${replay.status}`);
    }

    const noInit = await fetch(`${WORKER}/meta/oauth/start`, { redirect: "manual" });
    record("R13 oauth/start no init token: 403", noInit.status === 403, `HTTP ${noInit.status}`);

    const csCross = await fetch(`${WORKER}/meta/connection-status?bot_id=${DEMO_BOT}`, {
      headers: { "Authorization": `Bearer ${jwts.bombers_setter}` },
    });
    record("R14 connection-status cross-tenant: 403", csCross.status === 403, `HTTP ${csCross.status}`);
    const csOwn = await fetch(`${WORKER}/meta/connection-status?bot_id=${BOMBERS_BOT}`, {
      headers: { "Authorization": `Bearer ${jwts.bombers_setter}` },
    });
    record("R14 control: connection-status own bot: 200", csOwn.status === 200, `HTTP ${csOwn.status}`);
  }

  // ---- Cleanup: fixture out, verify gone ------------------------------------
  {
    const del = await fetch(`${URL_}/rest/v1/reviews?id=eq.${FIXTURE_ID}`, {
      method: "DELETE", headers: { ...svc, "Prefer": "return=representation" },
    });
    const gone = del.ok ? await del.json() : [];
    record("cleanup: fixture review deleted", del.status === 200 && gone.length === 1,
      `HTTP ${del.status}, deleted=${gone.length}`);
  }

  console.log("");
  const fails = results.filter(r => !r.pass);
  console.log(`=== ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length) {
    console.log("FAILED ROWS:");
    for (const f of fails) console.log(`  ${f.row}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error("MATRIX ABORTED: " + (e && e.message));
  console.error("If a fixture review was created it may remain; delete rows with");
  console.error("customer_id tester_matrix on the demo bot via the service key.");
  process.exit(1);
});
