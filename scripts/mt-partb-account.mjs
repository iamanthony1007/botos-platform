// scripts/mt-partb-account.mjs
// Part B: creates Nella's tenant-staff account on PRODUCTION and proves its
// isolation, per Anthony's 2026-08-30 ruling. Run AFTER the seed
// (db/seeds/nella_tenant_2026-08-30.sql) has verified: the profile references
// the ...00e0 org and ...00e1 bot the seed creates.
//
// Anthony runs this. Masked-key pattern, service key never typed into chat:
//
//   PowerShell 5.1, from the repo root:
//     $sec = Read-Host -Prompt "Paste PRODUCTION service key" -AsSecureString
//     $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
//     $env:PROD_SUPABASE_SERVICE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
//     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
//     node scripts/mt-partb-account.mjs
//     Remove-Item Env:\PROD_SUPABASE_SERVICE_KEY
//     $sec = $null
//
// WHAT IT DOES, in order:
//   1. Creates auth user Nellaledonne6803@proton.me (email_confirm: true).
//      Idempotent: reuses the existing auth user if present. NO PASSWORD is
//      set, per the standing rule; she sets her own via step 5's email.
//   2. Upserts the profile row EXACTLY as ruled: role admin, organization
//      ...00e0, assigned_bot_id ...00e1, permissions ["inbox","connections"].
//   3. Prints the landed profile row for eyeball verification.
//   4. Mints a session as her account (admin magiclink + verify, token stays
//      in process memory) and runs the both-sides isolation probes: she reads
//      her own EMPTY tenant, and zero rows of anyone else's, the same shape
//      the production matrix used.
//   5. LAST, only if every probe passed: triggers Supabase's password
//      recovery email to her address (redirects to getmu.co/reset-password,
//      the ForgotPassword flow's own target), so she sets her own password.
//      Ordering is deliberate: her email arrives only after her account is
//      proven correctly scoped.

const URL_ = "https://rydkwsjwlgnivlwlvqku.supabase.co";
const KEY = process.env.PROD_SUPABASE_SERVICE_KEY;
// Public anon key, same value the dashboard ships in its bundle.
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5ZGt3c2p3bGduaXZsd2x2cWt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDA1ODEsImV4cCI6MjA5MTA3NjU4MX0.8Th4ObB8I22BgbedX8_S1CAdSlAAZ3nXk8ScA7164G4";

const EMAIL = "Nellaledonne6803@proton.me";
const NAME = "Nella";
const ORG_ID = "00000000-0000-0000-0000-0000000000e0"; // Nella's bot org (seed)
const BOT_ID = "00000000-0000-0000-0000-0000000000e1"; // Nella's bot (seed)
const BOMBERS_BOT = "00000000-0000-0000-0000-000000000002";
const SUPERYOU_BOT = "45b776e3-ee4f-461d-a526-4249d18757b3";
const RESET_REDIRECT = "https://getmu.co/reset-password";

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

async function findUserByEmail(email) {
  const r = await fetch(`${URL_}/auth/v1/admin/users?page=1&per_page=200`, { headers: svc });
  if (!r.ok) throw new Error(`admin list users ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const users = Array.isArray(j) ? j : (j.users || []);
  return users.find(u => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function mintSession(email) {
  const gl = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
    method: "POST", headers: svc,
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!gl.ok) throw new Error(`generate_link ${gl.status}: ${await gl.text()}`);
  const j = await gl.json();
  const tokenHash = (j.properties && j.properties.hashed_token) || j.hashed_token;
  if (!tokenHash) throw new Error("no hashed_token in generate_link response");
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
  throw new Error("verify failed");
}

async function restGet(jwt, path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { "apikey": ANON, "Authorization": `Bearer ${jwt}` },
  });
  const text = await r.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch (e) { rows = null; }
  return { status: r.status, rows: Array.isArray(rows) ? rows : null };
}

async function main() {
  console.log("=== Part B: Nella tenant-staff account (production) ===");

  // 1. Auth user.
  let user = await findUserByEmail(EMAIL);
  if (user) {
    console.log(`auth user exists: ${user.id}`);
  } else {
    const r = await fetch(`${URL_}/auth/v1/admin/users`, {
      method: "POST", headers: svc,
      body: JSON.stringify({ email: EMAIL, email_confirm: true }),
    });
    if (!r.ok) throw new Error(`admin create user ${r.status}: ${await r.text()}`);
    user = await r.json();
    console.log(`auth user created: ${user.id}`);
  }
  if (!user || !user.id) throw new Error("no user id resolved");

  // 2. Profile row, exactly as ruled.
  const pr = await fetch(`${URL_}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: { ...svc, "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      id: user.id,
      email: EMAIL,
      name: NAME,
      role: "admin",
      organization_id: ORG_ID,
      assigned_bot_id: BOT_ID,
      permissions: ["inbox", "connections"],
      disabled: false,
    }),
  });
  if (!pr.ok) throw new Error(`profile upsert ${pr.status}: ${await pr.text()}`);
  const written = (await pr.json())[0];

  // 3. Eyeball verification of what landed.
  console.log("profile row as landed:");
  console.log(JSON.stringify(written, null, 2));
  record("profile: role admin", written.role === "admin", `role=${written.role}`);
  record("profile: org = Nella's bot org", written.organization_id === ORG_ID,
    `org=${written.organization_id}`);
  record("profile: bot = Nella's bot", written.assigned_bot_id === BOT_ID,
    `bot=${written.assigned_bot_id}`);
  record("profile: permissions inbox+connections",
    JSON.stringify(written.permissions) === JSON.stringify(["inbox", "connections"]),
    `perms=${JSON.stringify(written.permissions)}`);
  record("profile: enabled", written.disabled === false, `disabled=${written.disabled}`);

  // 4. Both-sides isolation, as her.
  const jwt = await mintSession(EMAIL);
  console.log("session minted as her account (token in memory only)");

  const bots = await restGet(jwt, "bots?select=id,name");
  const ids = (bots.rows || []).map(b => b.id);
  record("isolation: sees exactly her bot", ids.length === 1 && ids[0] === BOT_ID,
    `ids=[${ids.join(",")}]`);
  const ownConv = await restGet(jwt, "conversations?select=id&limit=5");
  record("isolation: her tenant is empty", ownConv.status === 200 && (ownConv.rows || []).length === 0,
    `HTTP ${ownConv.status}, rows=${(ownConv.rows || []).length}`);
  const bb = await restGet(jwt, `conversations?select=id&bot_id=eq.${BOMBERS_BOT}&limit=5`);
  record("isolation: zero Bombers conversations", bb.status === 200 && (bb.rows || []).length === 0,
    `HTTP ${bb.status}, rows=${(bb.rows || []).length}`);
  const bbr = await restGet(jwt, `reviews?select=id&bot_id=eq.${BOMBERS_BOT}&limit=5`);
  record("isolation: zero Bombers reviews", bbr.status === 200 && (bbr.rows || []).length === 0,
    `HTTP ${bbr.status}, rows=${(bbr.rows || []).length}`);
  const sy = await restGet(jwt, `conversations?select=id&bot_id=eq.${SUPERYOU_BOT}&limit=5`);
  record("isolation: zero SuperYOU conversations", sy.status === 200 && (sy.rows || []).length === 0,
    `HTTP ${sy.status}, rows=${(sy.rows || []).length}`);
  const ca = await restGet(jwt, "connected_accounts?select=id&limit=1");
  record("isolation: connected_accounts unreachable", ca.status === 200 && (ca.rows || []).length === 0,
    `HTTP ${ca.status}, rows=${(ca.rows || []).length}`);

  const fails = results.filter(r => !r.pass);
  console.log("");
  console.log(`=== ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length) {
    console.log("RECOVERY EMAIL NOT SENT: fix the failures first, re-run.");
    process.exit(1);
  }

  // 5. Recovery email, only on a clean board.
  const rec = await fetch(`${URL_}/auth/v1/recover?redirect_to=${encodeURIComponent(RESET_REDIRECT)}`, {
    method: "POST",
    headers: { "apikey": ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL }),
  });
  if (!rec.ok) {
    console.log(`RECOVERY EMAIL FAILED: HTTP ${rec.status} ${await rec.text()}`);
    console.log("The account is verified and safe; re-trigger via the dashboard's");
    console.log("Forgot password link for " + EMAIL + " instead.");
    process.exit(1);
  }
  console.log(`recovery email sent to ${EMAIL}, redirecting to ${RESET_REDIRECT}`);
  console.log("She sets her own password from that email. Nobody else ever holds one.");
}

main().catch(e => {
  console.error("ABORTED: " + (e && e.message));
  process.exit(1);
});
