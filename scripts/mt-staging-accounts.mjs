// scripts/mt-staging-accounts.mjs
// MT Phase 1 staging matrix prep: creates the bombers-setter-sim test account
// on STAGING, per docs/MT-PHASE-1-STAGING-PLAN.md Section 2.
//
// RUN THIS AFTER CHUNK 2 AND BEFORE CHUNK 3 of migration 011: the profile is
// created with organization_id NULL on purpose, so chunk 3's backfill filling
// it in is itself one of the things under test.
//
// Anthony runs this. The service key is read from an environment variable so
// it is never typed into chat, never written to a file, and never printed by
// this script. Set it with the masked prompt, NOT a plain $env: assignment
// (PSReadLine history is the leak path from the token incident):
//
//   PowerShell 5.1, from the repo root:
//     $sec = Read-Host -Prompt "Paste STAGING service key" -AsSecureString
//     $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
//     $env:STAGING_SUPABASE_SERVICE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
//     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
//     node scripts/mt-staging-accounts.mjs
//     Remove-Item Env:\STAGING_SUPABASE_SERVICE_KEY
//     $sec = $null
//
// Target is STAGING only: the URL is hardcoded to the staging project ref and
// there is no production fallback. Idempotent: safe to re-run, it finds the
// existing auth user by email and upserts the profile row.
//
// No password is set on the account, per the standing no-passwords rule.
// Matrix sessions are minted separately via the admin API at matrix time.

const STAGING_URL = "https://hlpucysbaqerhwahfolg.supabase.co";
const KEY = process.env.STAGING_SUPABASE_SERVICE_KEY;

const EMAIL = "bombers-setter-sim@staging.getmu.co";
const NAME = "Bombers Setter Simulation (staging)";
const BOT_ID = "00000000-0000-0000-0000-000000000002"; // Bombers Blueprint (staging)

if (!KEY) {
  console.error("STAGING_SUPABASE_SERVICE_KEY is not set. See the header of this file.");
  process.exit(1);
}

const authHeaders = {
  "apikey": KEY,
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function findUserByEmail(email) {
  // Staging holds a handful of users; one page is plenty.
  const r = await fetch(`${STAGING_URL}/auth/v1/admin/users?page=1&per_page=100`, {
    headers: authHeaders,
  });
  if (!r.ok) throw new Error(`admin list users ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const users = Array.isArray(j) ? j : (j.users || []);
  return users.find(u => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function main() {
  console.log("=== MT staging matrix account prep (staging only) ===");

  // 1. Auth user: reuse if present, create otherwise.
  let user = await findUserByEmail(EMAIL);
  if (user) {
    console.log(`auth user exists: ${user.id}`);
  } else {
    const r = await fetch(`${STAGING_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ email: EMAIL, email_confirm: true }),
    });
    if (!r.ok) throw new Error(`admin create user ${r.status}: ${await r.text()}`);
    user = await r.json();
    console.log(`auth user created: ${user.id}`);
  }
  if (!user || !user.id) throw new Error("no user id resolved, aborting before the profile write");

  // 2. Profile row, upsert on id. organization_id DELIBERATELY null here:
  // chunk 3 of migration 011 must backfill it to the Bombers Blueprint org,
  // and the optional map select in that chunk is where that is checked.
  const profile = {
    id: user.id,
    email: EMAIL,
    name: NAME,
    role: "setter",
    permissions: ["inbox"],
    assigned_bot_id: BOT_ID,
    organization_id: null,
    disabled: false,
  };
  const pr = await fetch(`${STAGING_URL}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: { ...authHeaders, "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(profile),
  });
  if (!pr.ok) throw new Error(`profile upsert ${pr.status}: ${await pr.text()}`);
  const written = (await pr.json())[0];

  // 3. Show what landed (nothing sensitive in a profiles row).
  console.log("profile row:");
  console.log(JSON.stringify(written, null, 2));
  console.log("");
  console.log("EXPECTED: role=setter, permissions=[inbox], assigned_bot_id=" + BOT_ID);
  console.log("EXPECTED: organization_id=null (chunk 3 backfills it; re-run this script");
  console.log("          after chunk 3 and the row should show the Bombers org id)");
  console.log("");
  console.log("Done. Record in PROGRESS as a staging artifact, like reviewer-sim.");
}

main().catch(e => {
  console.error("FAILED: " + (e && e.message));
  process.exit(1);
});
