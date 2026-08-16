// Stage 4 staging pipeline test. Posts 3 synthetic Instagram webhook events to the
// STAGING Worker, signed with the real INSTAGRAM_APP_SECRET.
//
// Anthony runs this. The secret is read from an environment variable so it is never
// typed into chat, never written to a file, and never printed by this script.
//
// INVOCATION: use the masked prompt below, EXACTLY as written. Do NOT set the env var
// with a plain $env:NAME="value" assignment: that puts the secret verbatim into the
// PSReadLine command history file, which is the exact leak path from the token
// incident. Read-Host input is masked and is not recorded in history.
//
//   PowerShell 5.1, from the repo root:
//     $sec = Read-Host -Prompt "Paste INSTAGRAM_APP_SECRET" -AsSecureString
//     $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
//     $env:INSTAGRAM_APP_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
//     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
//     node scripts/stage4-staging-events.mjs
//     Remove-Item Env:\INSTAGRAM_APP_SECRET
//     $sec = $null
//
// Target is STAGING only. It posts to sales-bot-staging.nellakuate.workers.dev and
// uses TEST- fixture ids, so it cannot touch production or a real lead.
//
// TWO DISTINCT IDS, do not conflate them when checking the database:
//   IG_ACCOUNT (recipient.id) is the BUSINESS. It must match
//     connected_accounts.external_account_id, which is what resolveConnectedAccount
//     looks up to find the bot.
//   IG_SENDER (sender.id) is the LEAD. It plays the waId role, so THIS is the value
//     that becomes conversations.customer_id and the review row's customer_id.
// So the conversation to verify afterwards is keyed on IG_SENDER, not IG_ACCOUNT.
//
// Cost: 2 Claude calls and 2 Voyage embeddings on Nella's staging key. The third
// event is a deliberate duplicate and must cost nothing.

import crypto from "node:crypto";

const WORKER = "https://sales-bot-staging.nellakuate.workers.dev";
const SECRET = process.env.INSTAGRAM_APP_SECRET;
if (!SECRET) {
  console.error("INSTAGRAM_APP_SECRET is not set. See the header of this file.");
  process.exit(1);
}

// TEST fixture: matches the connected_accounts row created for this test.
const IG_ACCOUNT = "TEST-IG-STAGE4-99001";   // recipient.id, the business
const IG_SENDER = "TEST-IGSID-STAGE4-77001"; // sender.id, the synthetic lead
const RUN = Date.now();

function event(mid, text) {
  return {
    object: "instagram",
    entry: [{
      id: IG_ACCOUNT,
      time: Date.now(),
      messaging: [{
        sender: { id: IG_SENDER },
        recipient: { id: IG_ACCOUNT },
        timestamp: Date.now(),
        message: { mid, text }
      }]
    }]
  };
}

async function post(label, payload) {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  const r = await fetch(WORKER + "/instagram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
    body: raw
  });
  // Report status and body LENGTH only, never the body itself. The Worker's replies
  // here are short and non-sensitive, but printing response bodies is a habit that
  // eventually prints something that matters, so it is not done at all.
  const body = await r.text();
  console.log(label.padEnd(34) + " -> HTTP " + r.status + " (body " + body.length + " bytes)");
  if (!r.ok) console.log("   non-2xx: check the wrangler tail for the reason, not this output");
  return r.status;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MID_1 = "mid-stage4-" + RUN + "-a";
const MID_2 = "mid-stage4-" + RUN + "-b";

console.log("Posting to STAGING as account " + IG_ACCOUNT + ", sender " + IG_SENDER);
console.log("");

// 1. First message: creates the conversation, one Claude call.
await post("1 first message (new convo)", event(MID_1, "Hi, I saw your golf content. What do you offer?"));
// The pipeline runs in the background; give it room before the next turn so the
// second message appends to a conversation that already exists.
await sleep(25000);

// 2. Second message, distinct mid: appends a turn, one Claude call.
await post("2 second message (append turn)", event(MID_2, "I play off 18 and I want to break 90 this year."));
await sleep(25000);

// 3. Duplicate of message 2: must be deduped, zero Claude calls, no new review row.
await post("3 duplicate of #2 (dedup test)", event(MID_2, "I play off 18 and I want to break 90 this year."));
await sleep(8000);

console.log("");
console.log("Done. All three should be HTTP 200 (Meta always gets a 200).");
console.log("Claude has now been called twice. The third event must have cost nothing.");
console.log("Tell Claude Code it is finished and it will verify the database and the tail.");
