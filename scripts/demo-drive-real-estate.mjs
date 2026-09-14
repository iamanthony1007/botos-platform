// Real Estate Demo conversation driver. Posts synthetic, signed Instagram
// webhook events to the PRODUCTION Worker so the Real Estate Demo tenant's
// inbox fills with Nella's simulation-pack conversations before the client
// demo. Production variant of scripts/stage4-staging-events.mjs.
//
// WHAT IT DEPENDS ON, in order (do not run before all three exist):
//   1. The Real Estate Demo tenant is seeded
//      (db/seeds/real_estate_demo_tenant_2026-09-14.sql, bot ...00e1).
//   2. Anthony has CONNECTED the demo Instagram account from a profile whose
//      assigned bot is the demo bot. That creates the connected_accounts row
//      the Worker resolves bots by. Without it, every event lands nowhere.
//   3. DEMO_IG_ACCOUNT_ID below is set to that row's external_account_id
//      (select external_account_id from connected_accounts
//       where bot_id = '00000000-0000-0000-0000-0000000000e1'
//         and deauthorized = false).
//
// Anthony runs this. The app secret is read from an environment variable via
// the masked prompt so it is never typed into chat, never written to a file,
// and never printed. INVOCATION, PowerShell 5.1 from the repo root:
//
//   $sec = Read-Host -Prompt "Paste INSTAGRAM_APP_SECRET" -AsSecureString
//   $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
//   $env:INSTAGRAM_APP_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
//   [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
//   $env:DEMO_IG_ACCOUNT_ID = "<external_account_id from the connect>"
//   node scripts/demo-drive-real-estate.mjs --list          # review the plan
//   node scripts/demo-drive-real-estate.mjs --run           # actually post
//   Remove-Item Env:\INSTAGRAM_APP_SECRET
//   Remove-Item Env:\DEMO_IG_ACCOUNT_ID
//   $sec = $null
//
// SAFE BY DEFAULT: without --run the script only prints the plan. --only=<key>
// limits a run to one persona (keys printed by --list).
//
// TWO DISTINCT IDS, do not conflate them when checking the database:
//   DEMO_IG_ACCOUNT_ID (recipient.id) is the BUSINESS. It must match
//     connected_accounts.external_account_id; resolveConnectedAccount looks it
//     up to find the demo bot.
//   Each persona's igsid (sender.id) is the LEAD. It becomes
//     conversations.customer_id and the review rows' customer_id, and it is
//     what db/seeds/real_estate_demo_naming_2026-09-14.sql keys on afterwards.
//
// PERSONAS: Nella's Demo Conversation Simulation Pack, verbatim opening
// messages for the four primary scenarios, follow-up turns written along her
// "expected conversation direction" notes, plus two of her randomized
// variations. auto_send is false on the demo bot, so every bot reply lands as
// a PENDING REVIEW in the inbox (the Human Agent flow), not as a sent DM: the
// lead turns are therefore scripted to follow her expected direction rather
// than reacting to a delivered reply.
//
// COST: one Claude call and one Voyage embedding per lead turn, 16 turns
// total on Nella's production keys. No Make scenario is touched, no real lead
// is touched, nothing is sent to Instagram (review path only).

import crypto from "node:crypto";

const WORKER = "https://sales-bot.nellakuate.workers.dev";
const TURN_GAP_MS = 25000;   // let the pipeline finish before the next turn
const PERSONA_GAP_MS = 10000;

const PERSONAS = [
  {
    key: "low",
    label: "Simulation 1, LOW intent, casual follower (Jordan)",
    igsid: "990914100101",
    turns: [
      "Hey, I saw your post about buying your first investment property. Can you send me the First Property in 90 Days roadmap?",
      "Honestly I'm not sure yet. I've just been watching your videos and wondering if it's something I could eventually do.",
      "Probably a few years away for me if I'm real. Just want to learn the basics for now.",
    ],
  },
  {
    key: "medium",
    label: "Simulation 2, MEDIUM intent, warm lead (Maya)",
    igsid: "990914100202",
    turns: [
      "Can you send me the First Property in 90 Days roadmap? I've been researching rentals for a while and I'm hoping to buy next year.",
      "Mostly financing honestly. I have some savings but I don't really know what I'd qualify for. I haven't talked to a lender yet.",
      "Yeah a webinar would be helpful. I want to understand the process properly before I commit to anything.",
    ],
  },
  {
    key: "high",
    label: "Simulation 3, HIGH intent, call-ready (Chris)",
    igsid: "990914100303",
    turns: [
      "I'd like the First Property in 90 Days roadmap. I'm trying to buy my first rental in the next 3-4 months. I've already talked to a lender and I'm looking at properties, but I'm not confident I'm evaluating the deals correctly.",
      "Exactly. I can find listings all day, I just don't trust my own numbers yet. Every time a deal looks good I second-guess what I'm missing.",
      "Yeah, I'd be open to talking to someone about it. What's the next step?",
    ],
  },
  {
    key: "objection",
    label: "Simulation 4, HIGH intent, objection then close to booking (Taylor)",
    igsid: "990914100404",
    turns: [
      "Send me the roadmap. I really want to buy my first property this year, but honestly I don't think I'm ready. I don't have that much money and I'm worried I won't qualify.",
      "No lender has told me anything, I just assumed. I've saved around 20k and I think my credit is okay, I've just never done any of this before.",
      "That actually makes me feel better. If someone could walk me through what I'd realistically qualify for, I'd want that. How do I set it up?",
    ],
  },
  {
    key: "var-surprise",
    label: "Variation, guide request that reveals a 90-day timeline (Sam)",
    igsid: "990914100505",
    turns: [
      "Can I get the roadmap guide?",
      "Actually my lease ends in about 3 months, so I was hoping to buy my first place around then and rent part of it out. I've got a down payment saved already.",
    ],
  },
  {
    key: "var-browsing",
    label: "Variation, sounds hot then reveals just browsing (Dana)",
    igsid: "990914100606",
    turns: [
      "This is exactly what I need!! I've always wanted to get into real estate investing.",
      "Oh no real timeline, I just love watching this stuff. Maybe someday when things settle down for me.",
    ],
  },
];

const args = process.argv.slice(2);
const LIST_ONLY = !args.includes("--run");
const onlyArg = args.find(a => a.startsWith("--only="));
const selected = onlyArg
  ? PERSONAS.filter(p => p.key === onlyArg.split("=")[1])
  : PERSONAS;

if (onlyArg && selected.length === 0) {
  console.error("Unknown persona key. Keys: " + PERSONAS.map(p => p.key).join(", "));
  process.exit(1);
}

const totalTurns = selected.reduce((n, p) => n + p.turns.length, 0);

console.log("Real Estate Demo driver, target: PRODUCTION " + WORKER);
console.log(selected.length + " persona(s), " + totalTurns + " lead turns, ~" + totalTurns + " Claude calls.");
console.log("");
for (const p of selected) {
  console.log("[" + p.key + "] " + p.label + "  (sender " + p.igsid + ")");
  p.turns.forEach((t, i) => console.log("   turn " + (i + 1) + ": " + t));
  console.log("");
}

if (LIST_ONLY) {
  console.log("PLAN ONLY. Nothing was posted. Re-run with --run to post for real.");
  process.exit(0);
}

const SECRET = process.env.INSTAGRAM_APP_SECRET;
const IG_ACCOUNT = process.env.DEMO_IG_ACCOUNT_ID;
if (!SECRET) {
  console.error("INSTAGRAM_APP_SECRET is not set. See the header of this file.");
  process.exit(1);
}
if (!IG_ACCOUNT) {
  console.error("DEMO_IG_ACCOUNT_ID is not set. It is connected_accounts.external_account_id");
  console.error("for the demo bot, which exists only AFTER Anthony's connect. See the header.");
  process.exit(1);
}

const RUN = Date.now();

function event(igsid, mid, text) {
  return {
    object: "instagram",
    entry: [{
      id: IG_ACCOUNT,
      time: Date.now(),
      messaging: [{
        sender: { id: igsid },
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
  // Status and body LENGTH only, never the body: printing response bodies is a
  // habit that eventually prints something that matters.
  const body = await r.text();
  console.log(label.padEnd(46) + " -> HTTP " + r.status + " (body " + body.length + " bytes)");
  if (!r.ok) console.log("   non-2xx: check the wrangler tail for the reason, not this output");
  return r.status;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("POSTING TO PRODUCTION in 5 seconds. Ctrl+C to abort.");
await sleep(5000);

for (const p of selected) {
  console.log("");
  console.log("=== " + p.label + " ===");
  for (let i = 0; i < p.turns.length; i++) {
    const mid = "mid-redemo-" + RUN + "-" + p.key + "-" + (i + 1);
    await post(p.key + " turn " + (i + 1) + "/" + p.turns.length, event(p.igsid, mid, p.turns[i]));
    if (i < p.turns.length - 1) await sleep(TURN_GAP_MS);
  }
  await sleep(PERSONA_GAP_MS);
}

console.log("");
console.log("Done. All posts should be HTTP 200 (Meta always gets a 200).");
console.log("Next: run db/seeds/real_estate_demo_naming_2026-09-14.sql in the SQL");
console.log("editor to name the conversations, then open the demo inbox.");
