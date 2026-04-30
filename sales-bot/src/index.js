var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
const BOT_ID = "00000000-0000-0000-0000-000000000002";
const SUPABASE_URL = "https://rydkwsjwlgnivlwlvqku.supabase.co";

// FALLBACK PROMPT - only used if Supabase fails
const FALLBACK_SYSTEM_PROMPT = `You are Coach Shaun responding to golfers via Instagram DMs. You are an expert appointment setter. Your sole responsibility is to determine fit and book Zoom calls. You sort, not sell.`;

// Typing delay calculator
// Flat 10 second delay per message so replies feel human and un-hurried
function calcTypingDelay(text) {
  const variation = (Math.random() - 0.5) * 2000;       // +/-1s natural variation
  return Math.round(10000 + variation);                 // ~10s per message
}
__name(calcTypingDelay, "calcTypingDelay");

// Row 18: Em-dash sanitizer. Replaces em-dash, en-dash, double-hyphen and
// the horizontal-bar variant with a period + space. Runs on every bot message
// before it is written to Supabase, sent to Make, or pushed to KV memory.
function sanitizeBotMessage(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/\s*[\u2014\u2013\u2015]+\s*/g, ". ")   // em dash, en dash, horizontal bar
    .replace(/\s--\s/g, ". ")                         // ASCII double-hyphen used as em-dash
    .replace(/\s-\s/g, ". ")                          // ASCII single hyphen used as em-dash with spaces
    .replace(/\.\s*\./g, ".")                         // collapse accidental double periods
    .replace(/\s{2,}/g, " ")                          // collapse double spaces
    .trim();
}
__name(sanitizeBotMessage, "sanitizeBotMessage");

// Row 30: Already-asked question check. Returns true if the proposed reply
// is too similar (>= 70% token overlap) to any assistant message in the last
// 10 turns. Used to block repeats.
function hasBotAlreadyAsked(proposed, memory) {
  if (!proposed || !memory?.messages) return false;
  const prior = memory.messages
    .filter(m => m.role === "assistant")
    .slice(-10)
    .map(m => (m.content || "").toLowerCase());
  if (prior.length === 0) return false;

  const tokens = (s) => (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3);

  const proposedTokens = new Set(tokens(proposed));
  if (proposedTokens.size < 3) return false;  // too short to judge

  for (const priorMsg of prior) {
    const priorTokens = new Set(tokens(priorMsg));
    if (priorTokens.size < 3) continue;
    let overlap = 0;
    for (const t of proposedTokens) if (priorTokens.has(t)) overlap++;
    const similarity = overlap / Math.min(proposedTokens.size, priorTokens.size);
    if (similarity >= 0.70) return true;
  }
  return false;
}
__name(hasBotAlreadyAsked, "hasBotAlreadyAsked");

// ─────────────────────────────────────────────────────────────────────
// fetchWithRetry
// Calls Anthropic (or any) API with exponential backoff on transient errors.
// Retries on: HTTP 429, 502, 503, 504, 529 and body { type: "error", error: { type: "overloaded_error" | "rate_limit_error" } }
// Total attempts = 4 (original + 3 retries). Delays = 2s, 4s, 8s. Max ~14s before giving up.
// Returns the final response (success or exhausted). Never throws.
async function fetchWithRetry(url, opts, maxAttempts = 4) {
  const RETRY_STATUS = [429, 502, 503, 504, 529];
  const RETRY_ERROR_TYPES = ["overloaded_error", "rate_limit_error", "api_error"];
  let lastResponse = null;
  let lastBody = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, opts);

      // HTTP status says try again
      if (RETRY_STATUS.includes(response.status) && attempt < maxAttempts) {
        const body = await response.text();
        console.warn(`[retry] ${url} attempt ${attempt}/${maxAttempts} got ${response.status}: ${body.slice(0, 200)}`);
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // 200 but body says "overloaded_error" (rare, but Anthropic occasionally wraps errors in 200s)
      const raw = await response.clone().text();
      try {
        const body = JSON.parse(raw);
        if (body?.type === "error" && RETRY_ERROR_TYPES.includes(body?.error?.type) && attempt < maxAttempts) {
          console.warn(`[retry] ${url} attempt ${attempt}/${maxAttempts} body-error ${body.error.type}`);
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      } catch (_) { /* not JSON, fall through */ }

      // Either success or a non-retryable error - return as-is
      return response;
    } catch (networkErr) {
      // Network failure (DNS, TLS, socket): retry with backoff
      lastResponse = null;
      lastBody = networkErr.message;
      console.warn(`[retry] ${url} attempt ${attempt}/${maxAttempts} network error: ${networkErr.message}`);
      if (attempt === maxAttempts) {
        // Synthesise a response-like object so callers always get something
        return new Response(JSON.stringify({ type: "error", error: { type: "network_error", message: networkErr.message } }), {
          status: 599,
          headers: { "Content-Type": "application/json" }
        });
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return lastResponse;
}
__name(fetchWithRetry, "fetchWithRetry");

// Detects if an error thrown from callClaude() was caused by Anthropic overload
// (as opposed to a prompt error, parse error, etc). Used to decide whether to
// fall back to a placeholder review row vs return 500 to Make.
function isOverloadError(errMsg) {
  if (!errMsg) return false;
  const s = String(errMsg).toLowerCase();
  return s.includes("overloaded_error") ||
         s.includes("rate_limit_error") ||
         s.includes("network_error") ||
         s.includes("529") ||
         s.includes("503") ||
         s.includes("504") ||
         s.includes("502");
}
__name(isOverloadError, "isOverloadError");

var buildDeveloperPrompt = /* @__PURE__ */ __name((memory, messages) => {
  return `You are responding to a golf fitness coaching prospect via Instagram DM on behalf of Bombers Blueprint.

CUSTOMER MEMORY:
${JSON.stringify(memory, null, 2)}

RECENT CONVERSATION:
${messages.map((m) => `${m.role === "user" ? "Lead" : "You"}: ${m.content}`).join("\n")}

YOUR TASK:
Step 1 -- Read the SETTER CORRECTIONS at the top of the system prompt. Is this situation similar to any of them? If yes, apply what the setter taught you.
Step 2 -- Read the conversation. Where are we in the flow? What has been established?
Step 3 -- Write the best next reply based on the system guidelines AND the setter corrections.

=== MULTI-MESSAGE FORMAT ===
You can split your reply into 2-3 separate messages to sound more human and natural.
- Use multiple messages when reframing, coaching, or delivering a longer thought followed by a question
- Each message should be short and feel like a real text
- The LAST message should contain the question (if any)
- Simple short replies should be a single message
- NEVER send more than 3 messages
- NEVER repeat a sentence, phrase, or question already used earlier in this conversation

You MUST respond with ONLY a valid JSON object (no markdown, no explanation) with this EXACT structure:

{
  "conversation_stage": "HOOK / ENTRY|GOAL|DIAGNOSTIC|INSIGHT|PRIORITY|DECISION|INVITE|SCHEDULE|BOOKED|FOLLOW-UP",
  "confidence": 0.0-1.0,
  "messages": ["first message", "second message (optional)", "third message with question (optional)"],
  "reply": "all messages joined into one string — for logging only",
  "lead_intent": "LOW|MEDIUM|HIGH",
  "contact_type": "prospect|non_prospect",
  "primary_goal": "Distance|Pain/Injuries|Consistency|Unknown",
  "next_action": "AUTO_SEND|SEND_TO_INBOX_REVIEW|ESCALATE_TO_HUMAN",
  "escalation_reason": "only fill if ESCALATE_TO_HUMAN — one sentence why (e.g. lead asked for human, angry, second objection)",
  "emotional_state": "NEUTRAL|ENGAGED|CONFUSED|SKEPTICAL|DISENGAGING|FRUSTRATED|OBJECTING",
  "situation_clarity": 0.0,
  "response_quality": 0.0,
  "tags": ["relevant", "tags", "here"],
  "internal_notes": "your reasoning -- what stage are we at, did any setter corrections apply, what are you trying to achieve with this reply",
  "memory_update": {
    "profile_facts": {
      "golf_identity": "",
      "primary_goal": "",
      "what_theyve_tried": "",
      "timeframe": "",
      "current_approach_working": "",
      "priority_level": ""
    },
    "running_summary": "concise summary of conversation so far"
  }
}

LEAD INTENT CLASSIFICATION (you MUST output one of these per response):
- LOW: Vague, just browsing, avoids answering questions, says maybe later, no pain expressed
- MEDIUM: Has a goal, some engagement, mild frustration but no urgency, still exploring  
- HIGH: Clear pain point, time pressure, frustration, uses buyer language, ready to act now

CONTACT TYPE CLASSIFICATION (you MUST output one of these per response):
- prospect: Default. A potential customer/buyer who could become a coaching client. Has golf-related pain points, goals, or interest in the program. ALL standard sales conversations are prospects.
- non_prospect: Someone reaching out for a non-sales reason. Examples:
  • Podcast hosts inviting you as a guest
  • Fellow coaches reaching out as peers
  • Industry professionals (PTs, trainers, TPI coaches) wanting to connect/collaborate
  • Service vendors pitching their services to you
  • Parents/relatives explaining account access
  • Followers expressing only general appreciation with no goal/pain
  • Anyone where the conversation is NOT about them potentially becoming a coaching client
  
DEFAULT to "prospect" unless there is clear evidence the conversation is non-sales. Once classified as non_prospect, keep it non_prospect for the rest of that conversation. Brand new conversations with too little info should default to prospect.

CRITICAL RULES:
- Reply must sound like Australian coach -- short, natural, no corporate language
- Acknowledge then brief bridge then question when appropriate
- NO exclamation points, minimal punctuation
- One main question per message set (in the last message)
- Mirror their message length or go shorter
- If confidence < 0.75, set next_action to SEND_TO_INBOX_REVIEW
- If lead explicitly asks for a human, or shows anger/frustration, set next_action to ESCALATE_TO_HUMAN and fill escalation_reason
- If lead shows second objection in same conversation, set next_action to ESCALATE_TO_HUMAN
- If lead is DISENGAGING or CONFUSED and confidence < 0.70, set next_action to ESCALATE_TO_HUMAN
- If lead mentions a link, form, payment, or contract, set next_action to ESCALATE_TO_HUMAN
- If lead asks a question you do not know the answer to, set next_action to ESCALATE_TO_HUMAN
- If lead_intent is LOW, always set next_action to SEND_TO_INBOX_REVIEW
- If lead_intent is HIGH and situation_clarity >= 0.85 and response_quality >= 0.90, set next_action to AUTO_SEND
- If lead_intent is MEDIUM and situation_clarity >= 0.80 and response_quality >= 0.85 and stage is early (HOOK / ENTRY/GOAL/FOLLOW-UP), set next_action to AUTO_SEND
- confidence field = (situation_clarity * 0.4) + (response_quality * 0.6) — calculate this yourself
- NEVER set AUTO_SEND if asking a question the lead already answered
- SETTER CORRECTIONS at the top of the system prompt OVERRIDE your defaults. Check them FIRST before responding.
- Move through stages based on what has been established, not linearly
- NEVER mention pricing, program details, or provide coaching advice
- NEVER give workouts or exercises in DMs
- NEVER repeat anything already said earlier in this conversation
- The "reply" field must equal all messages joined with a space (for logging)

Focus on: What do they want. What have they tried. Is it working. Is this a priority now. What have they tried. Is it working. Is this a priority now.`;
}, "buildDeveloperPrompt");

// Supabase helpers

async function supabaseInsert(env, table, data) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const error = await response.text();
      console.error(`Supabase insert error (${table}):`, error);
      return { success: false, error: error };
    }
    return { success: true };
  } catch (error) {
    console.error(`Supabase insert exception (${table}):`, error);
    return { success: false, error: error.message };
  }
}
__name(supabaseInsert, "supabaseInsert");

async function supabaseUpdate(env, table, id, data) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const error = await response.text();
      console.error(`Supabase update error (${table}):`, error);
      return { success: false, error: error };
    }
    return { success: true };
  } catch (error) {
    console.error(`Supabase update exception (${table}):`, error);
    return { success: false, error: error.message };
  }
}
__name(supabaseUpdate, "supabaseUpdate");

async function supabaseUpsert(env, table, data, onConflict) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Prefer": "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const error = await response.text();
      console.error(`Supabase upsert error (${table}):`, error);
    }
  } catch (error) {
    console.error(`Supabase upsert exception (${table}):`, error);
  }
}
__name(supabaseUpsert, "supabaseUpsert");

async function getBotSettings(env) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/bots?id=eq.${BOT_ID}&select=auto_send_enabled,system_prompt,model,intent_definitions,lead_type,buyer_type,communication_style,campaign_goal,target_avatar,ai_behavior_settings,welcome_context`,
      {
        headers: {
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "apikey": env.SUPABASE_SERVICE_KEY
        }
      }
    );
    if (!response.ok) return { auto_send_enabled: false, system_prompt: null };
    const data = await response.json();
    if (!data || data.length === 0) return { auto_send_enabled: false, system_prompt: null };
    return data[0];
  } catch (error) {
    console.error("Error fetching bot settings:", error);
    return { auto_send_enabled: false, system_prompt: null };
  }
}
__name(getBotSettings, "getBotSettings");

// Stages that are safe to auto-send for MEDIUM intent leads
const MEDIUM_INTENT_AUTO_STAGES = [
  "HOOK / ENTRY",
  "GOAL",
  "FOLLOW-UP"
];

// Profile fact keys mapped to conversation stages
// If the fact is already known, skip auto-sending that stage
const STAGE_FACT_REQUIREMENTS = {
  "GOAL":       "primary_goal",
  "DIAGNOSTIC": "what_theyve_tried",
  "INSIGHT":    "current_approach_working",
  "PRIORITY":   "primary_goal",
  "INVITE":     "primary_goal",
};

function profileFactAlreadyKnown(stage, profileFacts) {
  const requiredFact = STAGE_FACT_REQUIREMENTS[stage];
  if (!requiredFact) return false; // no requirement for this stage
  const value = profileFacts?.[requiredFact];
  return value && value !== "" && value !== "Unknown" && value !== "unknown";
}

function resolveNextAction(botResponse, autoSendEnabled, profileFacts = {}, memory = {}) {
  const emotionalState = botResponse.emotional_state || "NEUTRAL";
  const intent = botResponse.lead_intent || "LOW";
  const stage = botResponse.conversation_stage || "";
  const situationClarity = botResponse.situation_clarity || 0;
  const responseQuality = botResponse.response_quality || 0;

  // Compute weighted confidence
  const confidence = (situationClarity * 0.4) + (responseQuality * 0.6);

  // ── 7 ESCALATION TRIGGERS ──────────────────────────────────────────────────
  // 1. Bot explicitly decided to escalate
  if (botResponse.next_action === "ESCALATE_TO_HUMAN") return "ESCALATE_TO_HUMAN";
  // 2. Lead asked for a human
  if (botResponse.escalation_reason && botResponse.escalation_reason.toLowerCase().includes("asked for human")) return "ESCALATE_TO_HUMAN";
  // 3. Lead is angry/frustrated
  if (emotionalState === "FRUSTRATED") return "ESCALATE_TO_HUMAN";
  // 4. Second objection detected
  const objectionCount = memory?.objection_count || 0;
  if (objectionCount >= 2) return "ESCALATE_TO_HUMAN";
  // 5. Lead disengaging AND low confidence
  if (emotionalState === "DISENGAGING" && confidence < 0.70) return "ESCALATE_TO_HUMAN";
  // 6. Lead confused AND very low confidence
  if (emotionalState === "CONFUSED" && confidence < 0.60) return "ESCALATE_TO_HUMAN";
  // 7. Unknown question or link/form/payment mentioned (bot flags this in escalation_reason)
  if (botResponse.escalation_reason && botResponse.escalation_reason.length > 5) return "ESCALATE_TO_HUMAN";

  // Auto-send must be enabled in settings
  if (!autoSendEnabled) return "SEND_TO_INBOX_REVIEW";

  // LOW intent — always send to review
  if (intent === "LOW") return "SEND_TO_INBOX_REVIEW";

  // Context check — if the info this message collects is already known, review first
  if (profileFactAlreadyKnown(stage, profileFacts)) return "SEND_TO_INBOX_REVIEW";

  // HIGH intent — auto-send if confidence is high
  if (intent === "HIGH" && situationClarity >= 0.85 && responseQuality >= 0.90) return "AUTO_SEND";

  // MEDIUM intent — auto-send only safe early stages
  if (intent === "MEDIUM" && situationClarity >= 0.80 && responseQuality >= 0.85 && MEDIUM_INTENT_AUTO_STAGES.includes(stage)) return "AUTO_SEND";

  // Everything else — review
  return "SEND_TO_INBOX_REVIEW";
}
__name(resolveNextAction, "resolveNextAction");


// Send messages directly to Make Scenario 2
async function sendToMakeScenario2(customerId, messages, typingDelays) {
  // Defense filter: block delivery to ghl_-prefixed customer_ids.
  // These are GHL-imported leads whose customer_id is a GHL contact ID,
  // not a valid ManyChat subscriber ID. ManyChat would reject them with
  // a BundleValidationError. Reconciliation feature handles cleanup;
  // this filter prevents new silent failures while leads await review.
  if (typeof customerId === 'string' && customerId.startsWith('ghl_')) {
    console.warn(`[Make filter] Blocked delivery to ghl_-prefixed customer_id: ${customerId}. Lead needs reconciliation.`);
    return { blocked: true, reason: 'ghl_id_pending_reconciliation' };
  }
  try {
    await fetch("https://hook.eu2.make.com/jknvsf64c05m0urc1f7qph523pi310st", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId,
        messages: messages,
        typing_delays_ms: typingDelays && typingDelays.length > 0 ? typingDelays : messages.map(() => 1500)
      })
    });
  } catch (e) {
    console.error("Make Scenario 2 error:", e);
  }
}

// Main Worker

var index_default = {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // /webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const body = await request.json();
        let { customer_id, message, channel = "instagram", username = null, profile_name = null } = body;

        // Row 27: Sanitize string fields. ManyChat sometimes sends an unresolved
        // variable placeholder (e.g. "{{last_input_text}}") as plain text instead
        // of the real value. Treat any such literal as missing rather than storing
        // the broken string. Also trim and convert empty strings to null.
        // Also strips known sentinel values like "null" / "undefined" / "false" that
        // ManyChat occasionally substitutes when a variable is genuinely empty.
        const cleanField = (v) => {
          if (v === null || v === undefined) return null;
          const s = String(v).trim();
          if (!s) return null;
          if (/^{{[^}]+}}$/.test(s)) return null;          // unresolved ManyChat placeholder
          if (/^(null|undefined|false|none|n\/a)$/i.test(s)) return null;
          return s;
        };
        username = cleanField(username);
        profile_name = cleanField(profile_name);
        // Note: we do NOT clean message here because the validation below requires
        // a non-empty message and we'd rather return a proper 400 than silently
        // proceed with no input to Claude.

        if (!customer_id || !message) {
          return new Response(JSON.stringify({ error: "Missing customer_id or message" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Row 27: We deliberately do NOT write a "Instagram Lead" fallback into
        // Supabase when both username and profile_name are missing. Instead we let
        // the dashboard's getLeadName() helper derive the display label from the
        // channel field on the fly. This keeps the database honest (NULL means
        // "we genuinely don't know") and lets us change display rules without
        // running SQL migrations.

        const [botSettings, memoryData] = await Promise.all([
          getBotSettings(env),
          env.MEMORY_STORE.get(`memory:${customer_id}`, { type: "json" })
        ]);

        const autoSendEnabled = botSettings.auto_send_enabled === true;
        const systemPrompt = botSettings.system_prompt || FALLBACK_SYSTEM_PROMPT;
        const botModel = botSettings.model || 'claude-sonnet-4-6';
        const intentDefs = botSettings.intent_definitions || {
          LOW: "Vague, just browsing, avoids answering, says maybe later, no pain expressed",
          MEDIUM: "Has a goal, some engagement, mild frustration but no urgency",
          HIGH: "Clear pain point, time pressure, uses buyer language, ready to act now"
        };

        const campaignConfig = {
          leadType: botSettings.lead_type || 'Cold',
          buyerType: botSettings.buyer_type || 'Emotional',
          commStyle: botSettings.communication_style || 'Hybrid',
          goal: botSettings.campaign_goal || 'General',
          avatar: botSettings.target_avatar || '',
          aiBehavior: botSettings.ai_behavior_settings || {}
        };

        let memory = memoryData || { messages: [], running_summary: "", profile_facts: {} };

        // ── GHL History Merge ─────────────────────────────────────────────────
        // If this is a new lead (no KV memory) and we have their username,
        // check Supabase for GHL historical conversation data and seed memory with it.
        // This gives the AI and setters full context on returning leads.
        if (!memoryData && username) {
          try {
            const ghlResp = await fetch(
              `${SUPABASE_URL}/rest/v1/conversations?bot_id=eq.${BOT_ID}&username=eq.${encodeURIComponent(username.toLowerCase())}&history_source=eq.ghl_import&select=messages,running_summary,profile_facts,total_messages&limit=1`,
              { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
            );
            if (ghlResp.ok) {
              const ghlData = await ghlResp.json();
              if (ghlData && ghlData.length > 0 && ghlData[0].messages && ghlData[0].messages.length > 0) {
                const ghlRecord = ghlData[0];
                // Seed memory with GHL history — keep last 30 messages as context
                const historicalMsgs = (ghlRecord.messages || []).slice(-30);
                memory.messages = historicalMsgs;
                memory.running_summary = ghlRecord.running_summary || "";
                memory.profile_facts = ghlRecord.profile_facts || {};
                memory.ghl_history_loaded = true;
                memory.ghl_total_messages = ghlRecord.total_messages || 0;
                console.log(`GHL history loaded for @${username}: ${historicalMsgs.length} messages seeded`);
              }
            }
          } catch (ghlErr) {
            console.error("GHL history lookup error:", ghlErr);
            // Non-fatal — continue without history
          }
        }

        // ── Bug 6: Supabase conversations fallback ────────────────────────────
        // If KV memory is empty AND GHL didn't seed anything, look up the lead's
        // own conversation row in Supabase and seed from there. This fixes the
        // case where KV memory was lost (eviction, region inconsistency, manual
        // delete) and the stage guardrail at line ~714 would otherwise downgrade
        // a SCHEDULE-stage lead back to HOOK / ENTRY because it sees only 1 user
        // message in memory. We are the source of truth, not the cache.
        if (!memoryData && memory.messages.length === 0 && customer_id) {
          try {
            const convResp = await fetch(
              `${SUPABASE_URL}/rest/v1/conversations?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&select=messages,running_summary,profile_facts,total_messages,conversation_stage&limit=1`,
              { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
            );
            if (convResp.ok) {
              const convData = await convResp.json();
              if (convData && convData.length > 0 && Array.isArray(convData[0].messages) && convData[0].messages.length > 0) {
                const record = convData[0];
                // Same window the Worker normally keeps in memory (15 messages)
                const recentMsgs = record.messages.slice(-15);
                memory.messages = recentMsgs;
                memory.running_summary = record.running_summary || "";
                memory.profile_facts = record.profile_facts || {};
                memory.recovered_from_supabase = true;
                console.log(`Memory rehydrated from Supabase for ${customer_id}: ${recentMsgs.length} messages, prior stage ${record.conversation_stage}`);
              }
            }
          } catch (rehydrateErr) {
            console.error("Supabase memory rehydrate error:", rehydrateErr);
            // Non-fatal — continue without history
          }
        }

        // Handle tester init — don't add the trigger to memory, just get opening message
        const isTesterInit = message === "__tester_init__";
        if (!isTesterInit) {
          memory.messages.push({ role: "user", content: message, timestamp: Date.now() });
          if (memory.messages.length > 15) memory.messages = memory.messages.slice(-15);
        }

        // ── Message batching ─────────────────────────────────────────────────
        // If a lead sends multiple messages within 60 seconds, batch them into
        // one AI response instead of creating separate reviews for each.
        // Check if there's a pending review created in the last 60 seconds.
        let batchReviewId = null;
        if (!isTesterInit) {
          try {
            const sixtySecsAgo = new Date(Date.now() - 60000).toISOString();
            const batchResp = await fetch(
              `${SUPABASE_URL}/rest/v1/reviews?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&status=eq.pending&created_at=gte.${sixtySecsAgo}&order=created_at.desc&limit=1`,
              { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
            );
            if (batchResp.ok) {
              const batchData = await batchResp.json();
              if (batchData && batchData.length > 0) {
                batchReviewId = batchData[0].id;
                console.log(`Batching: found recent pending review ${batchReviewId} for ${customer_id}, will update instead of creating new`);
                // Remove the previous assistant message from memory since we're regenerating
                const lastAssistantIdx = memory.messages.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0).pop();
                if (lastAssistantIdx !== undefined && lastAssistantIdx >= 0) {
                  memory.messages.splice(lastAssistantIdx, 1);
                }
              }
            }
          } catch (batchErr) {
            console.error("Batch check error:", batchErr);
          }

          // ── Auto-discard stale pending reviews ─────────────────────────────
          // If this is NOT a batched message (no recent pending review found),
          // discard ALL old pending reviews for this lead. They are outdated
          // because the conversation has moved on or the lead was responded
          // to outside the system.
          if (!batchReviewId) {
            try {
              const discardResp = await fetch(
                `${SUPABASE_URL}/rest/v1/reviews?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&status=eq.pending`,
                {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                    "apikey": env.SUPABASE_SERVICE_KEY,
                    "Prefer": "return=minimal"
                  },
                  body: JSON.stringify({
                    status: "discarded",
                    resolved_at: new Date().toISOString(),
                    internal_notes: "[System: Auto-discarded - lead sent a new message, old review is outdated]"
                  })
                }
              );
              if (discardResp.ok) {
                console.log(`Auto-discarded old pending reviews for ${customer_id}`);
              }
            } catch (discardErr) {
              console.error("Auto-discard error:", discardErr);
            }
          }
        }

        const [learnings, documents] = await Promise.all([
          fetchRelevantLearnings(env, memory),
          fetchActiveDocuments(env)
        ]);

        // Bug 7: Read prior conversation state BEFORE calling Claude.
        // We need to know if the lead was previously followed up and what stage
        // they were at, so we can pass that context to Claude AND override the
        // stage afterward as a safety net.
        let wasFollowedUp = false;
        let priorStage = null;
        let priorPreFollowupStage = null;
        try {
          const priorResp = await fetch(
            `${SUPABASE_URL}/rest/v1/conversations?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&select=followup_count,re_engaged,conversation_stage,pre_followup_stage&limit=1`,
            { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
          );
          if (priorResp.ok) {
            const priorData = await priorResp.json();
            if (priorData && priorData.length > 0) {
              wasFollowedUp = (priorData[0].followup_count || 0) >= 1;
              if (priorData[0].re_engaged === true) wasFollowedUp = true;
              priorStage = priorData[0].conversation_stage || null;
              priorPreFollowupStage = priorData[0].pre_followup_stage || null;
            }
          }
        } catch (_) { /* non-fatal */ }

        // Pass re-engagement context to memory so Claude can see it in the prompt
        if (wasFollowedUp && priorPreFollowupStage && priorPreFollowupStage !== 'FOLLOW-UP') {
          memory.re_engagement_context = {
            previous_stage: priorPreFollowupStage,
            current_stored_stage: priorStage
          };
        }

        // Welcome context injection: when this is a fresh conversation
        // (lead just started replying), inject the bot's welcome_context so
        // Claude knows what flow / questions the lead is responding to.
        // We define "fresh" as 3 or fewer total messages, meaning we're
        // still in the first one or two AI exchanges with this lead.
        // No injection for re-engaged leads (they have their own context),
        // no injection once the conversation has progressed past the welcome.
        const totalMsgs = Array.isArray(memory.messages) ? memory.messages.length : 0;
        const isFreshConversation = totalMsgs <= 3 && !wasFollowedUp;
        if (isFreshConversation && botSettings.welcome_context && botSettings.welcome_context.trim().length > 0) {
          memory.welcome_context = botSettings.welcome_context.trim();
        }

        const botResponse = await callClaude(env, memory, learnings, documents, systemPrompt, botModel, intentDefs, campaignConfig);
        if (!botResponse || (!botResponse.reply && !botResponse.messages)) throw new Error("Invalid bot response structure");

        // Bug 2: Sanitize internal_notes (the AI Insight panel text) using the same
        // em-dash rules as bot messages. Previously the sanitiser only ran on the
        // outgoing message text, so em-dashes leaked into the AI Insight display
        // even though the public-facing reply was clean.
        if (botResponse.internal_notes) {
          botResponse.internal_notes = sanitizeBotMessage(botResponse.internal_notes);
        }

        // ── Multi-message normalisation ────────────────────────────────────
        // Use messages array if provided, otherwise fall back to single reply
        const rawMessages = Array.isArray(botResponse.messages) && botResponse.messages.length > 0
          ? botResponse.messages
          : [botResponse.reply];

        // Deduplicate — safety net for the glitch where bot repeats itself
        const dedupedMessagesRaw = rawMessages.filter((msg, idx, arr) =>
          arr.findIndex(m => m.trim().toLowerCase() === msg.trim().toLowerCase()) === idx
        );

        // Row 18: Sanitize every outgoing message to remove em-dashes before any storage or send
        const dedupedMessages = dedupedMessagesRaw
          .map(m => sanitizeBotMessage(m))
          .filter(m => m && m.length > 0);

        // Calculate typing delay per message
        const typingDelays = dedupedMessages.map(msg => calcTypingDelay(msg));
        const totalDelay = typingDelays.reduce((a, b) => a + b, 0);

        // Primary reply = all messages joined (for memory + logging)
        const joinedReply = dedupedMessages.join(" ");

        // Row 30: If the proposed reply repeats a question the bot already asked,
        // downgrade to review so a setter can rewrite it instead of auto-sending.
        const alreadyAsked = hasBotAlreadyAsked(joinedReply, memory);
        if (alreadyAsked) {
          botResponse.next_action = "SEND_TO_INBOX_REVIEW";
          botResponse.internal_notes = (botResponse.internal_notes || "") +
            " [System: Repeated-question guard triggered - bot was about to ask something already asked in the last 10 turns]";
        }

        // ── Intent classification from lead's last message ─────────────────
        // Intent must reflect the LEAD's words, not the bot's response.
        // We re-score here using the lead's actual last message as the source of truth.
        const lastUserMessage = (message || "").toLowerCase();
        const stage = (botResponse.conversation_stage || "").toUpperCase();

        function classifyIntentFromLeadMessage(msg, stage) {
          // HIGH intent signals — lead's own words showing urgency or commitment
          const highSignals = [
            /bomber/i,
            /back pain|knee pain|hip pain|shoulder pain/i,
            /struggling.*(month|year|week)/i,
            /affects my sleep/i,
            /very motivated|determined|ready to|want to start|need to fix/i,
            /cure me|sign me up|let.s do it|yes definitely|yeah for sure|yes sir|sounds good/i,
            /nothing.*(working|sticking|helping)/i,
            /tried everything/i,
            /restrict|can.t rotate|can.t swing/i,
            /high priority|urgent/i
          ];
          // LOW intent signals — delay, vague, or avoidance language
          const lowSignals = [
            /just curious|just browsing|just looking/i,
            /maybe later|sometime this year|eventually/i,
            /start with free|free content first|what do you suggest first/i,
            /hipflow|15min|speedandpower/i,
            /saw your post/i,
            /not sure yet|just exploring/i
          ];
          // MEDIUM intent signals — interested but no urgency
          const mediumSignals = [
            /improve consistency|more distance|reduce pain|move better/i,
            /interested in your program|wanted more info|heard about/i,
            /how much does it cost|what are the fees|how does it work|what does it involve/i,
            /I.d like to|I would like to|I want to work on/i
          ];

          const isHigh = highSignals.some(r => r.test(msg));
          const isMedium = !isHigh && mediumSignals.some(r => r.test(msg));
          const isLow = lowSignals.some(r => r.test(msg));

          // Stage-based overrides for late stages
          if (["SCHEDULE", "BOOKED"].includes(stage)) return "HIGH";
          if (stage === "FOLLOW-UP") return "LOW";
          if (stage === "INVITE") return "MEDIUM";

          if (isHigh) return "HIGH";
          if (isMedium) return "MEDIUM";
          if (isLow) return "LOW";

          // Fall back to Claude's classification if no signals detected
          return null;
        }

        const detectedIntent = classifyIntentFromLeadMessage(lastUserMessage, stage);
        if (detectedIntent) {
          if (detectedIntent !== botResponse.lead_intent) {
            botResponse.internal_notes = (botResponse.internal_notes || "") +
              ` [System: Intent corrected from ${botResponse.lead_intent} to ${detectedIntent} based on lead message signals]`;
            botResponse.lead_intent = detectedIntent;
          }
        }

        // Safety net: cannot be HIGH on first message unless bomber or strong pain signal
        const userMessageCount = memory.messages.filter(m => m.role === "user").length;
        if (userMessageCount <= 1 && botResponse.lead_intent === "HIGH" && detectedIntent !== "HIGH") {
          botResponse.lead_intent = "LOW";
          botResponse.internal_notes = (botResponse.internal_notes || "") + " [System: Intent reset to LOW - first message, no high-intent signals detected]";
        }

        // ── Stage classification guardrail ────────────────────────────────
        // Prevent AI from over-classifying stage on shallow conversations.
        // Early stages only until enough conversation depth exists.
        const EARLY_STAGES = ["HOOK / ENTRY", "GOAL", "DIAGNOSTIC"];
        const MID_STAGES = ["HOOK / ENTRY", "GOAL", "DIAGNOSTIC", "INSIGHT", "PRIORITY"];
        const currentStage = botResponse.conversation_stage || "";

        if (userMessageCount <= 1 && !EARLY_STAGES.includes(currentStage)) {
          const originalStage = currentStage;
          botResponse.conversation_stage = "HOOK / ENTRY";
          botResponse.internal_notes = (botResponse.internal_notes || "") + ` [System: Stage downgraded from ${originalStage} to HOOK / ENTRY - only 1 user message]`;
        } else if (userMessageCount <= 2 && !EARLY_STAGES.includes(currentStage)) {
          const originalStage = currentStage;
          botResponse.conversation_stage = "GOAL";
          botResponse.internal_notes = (botResponse.internal_notes || "") + ` [System: Stage downgraded from ${originalStage} to GOAL - only 2 user messages]`;
        } else if (userMessageCount <= 4 && !MID_STAGES.includes(currentStage)) {
          const originalStage = currentStage;
          botResponse.conversation_stage = "INSIGHT";
          botResponse.internal_notes = (botResponse.internal_notes || "") + ` [System: Stage capped from ${originalStage} to INSIGHT - only ${userMessageCount} user messages]`;
        }

        // ── Memory update ──────────────────────────────────────────────────
        const review_id = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const finalAction = resolveNextAction(botResponse, autoSendEnabled, memory.profile_facts, memory);

        memory.messages.push({
          role: "assistant",
          content: joinedReply,
          bot_messages: dedupedMessages,
          typing_delays: typingDelays,
          timestamp: Date.now(),
          review_id,
          message_count: dedupedMessages.length
        });

        if (botResponse.memory_update) {
          if (botResponse.memory_update.profile_facts) {
            memory.profile_facts = { ...memory.profile_facts, ...botResponse.memory_update.profile_facts };
          }
          if (botResponse.memory_update.running_summary) {
            memory.running_summary = botResponse.memory_update.running_summary;
          }
        }

        // Track objection count for escalation trigger #4
        if (botResponse.emotional_state === "OBJECTING") {
          memory.objection_count = (memory.objection_count || 0) + 1;
        }

        await env.MEMORY_STORE.put(`memory:${customer_id}`, JSON.stringify(memory));

        // Bug 7: Stage restoration on re-engagement.
        // If the lead was followed up and we have a pre_followup_stage stored,
        // override Claude's stage classification with the restored stage. This
        // ensures the conversation continues from where it left off rather than
        // resetting to a fresh-conversation stage like HOOK / ENTRY.
        // Belt-and-suspenders: we ALSO tell Claude in the prompt about this
        // (memory.re_engagement_context, set before callClaude), but this
        // override is the safety net.
        if (wasFollowedUp && priorPreFollowupStage && priorPreFollowupStage !== 'FOLLOW-UP') {
          if (botResponse.conversation_stage !== priorPreFollowupStage) {
            botResponse.internal_notes = (botResponse.internal_notes || "") +
              ` [System: Stage restored from ${botResponse.conversation_stage} to ${priorPreFollowupStage} - lead is re-engaging after follow-up]`;
            botResponse.conversation_stage = priorPreFollowupStage;
          }
        }

        // BOOKED auto-promotion on booking link send.
        // Per product decision: a lead is only considered BOOKED when the actual
        // booking form URL has been delivered. We detect this by scanning the
        // outgoing bot messages for the canonical Jotform domain. If found,
        // force the stage to BOOKED regardless of what Claude classified.
        // Domain match (not exact URL) so future form ID changes still work.
        const BOOKING_URL_PATTERN = /form\.jotform\.com/i;
        const outgoingText = (Array.isArray(botResponse.messages) && botResponse.messages.length > 0
          ? botResponse.messages.join(' ')
          : (botResponse.reply || '')) + ' ' + (botResponse.internal_notes || '');
        if (BOOKING_URL_PATTERN.test(outgoingText)) {
          if (botResponse.conversation_stage !== 'BOOKED') {
            botResponse.internal_notes = (botResponse.internal_notes || "") +
              ` [System: Stage promoted to BOOKED - booking form link detected in outgoing message]`;
            botResponse.conversation_stage = 'BOOKED';
          }
          // Also ensure intent reflects the booking moment
          if (botResponse.lead_intent !== 'HIGH') {
            botResponse.lead_intent = 'HIGH';
          }
        }

        // Bug 7: Determine the pre_followup_stage value to write.
        // Priority order:
        //   1. Keep existing value if already set (don't overwrite mid-cycle)
        //   2. If we're about to write FOLLOW-UP and the prior stage was something
        //      else, capture the prior stage as the pre-followup stage
        //   3. If lead has progressed past their pre_followup_stage, clear it
        let preFollowupStageToWrite = priorPreFollowupStage;
        const newStage = botResponse.conversation_stage;
        if (newStage === 'FOLLOW-UP' && priorStage && priorStage !== 'FOLLOW-UP' && !priorPreFollowupStage) {
          preFollowupStageToWrite = priorStage;
        } else if (priorPreFollowupStage && newStage && newStage !== 'FOLLOW-UP' && newStage !== priorPreFollowupStage) {
          // Stage has moved on past the saved value, no longer relevant
          // Only clear if the new stage represents actual progression (later stage)
          const stageOrder = ['HOOK / ENTRY', 'GOAL', 'DIAGNOSTIC', 'INSIGHT', 'PRIORITY', 'DECISION', 'INVITE', 'SCHEDULE', 'BOOKED'];
          const currentIdx = stageOrder.indexOf(newStage);
          const savedIdx = stageOrder.indexOf(priorPreFollowupStage);
          if (currentIdx > savedIdx && currentIdx >= 0) preFollowupStageToWrite = null;
        }

        ctx.waitUntil(supabaseUpsert(env, "conversations", {
          bot_id: BOT_ID,
          customer_id: String(customer_id),
          channel,
          // Bug 1 fix: status='booked' should ONLY be set when stage is BOOKED.
          // Previously this also fired on SCHEDULE which inflated the booked count
          // and silently filtered leads out of Closest to Booking. Mark Booked is
          // now exclusively a manual action (via the dashboard button) or set when
          // the AI itself promotes the stage to BOOKED.
          status: botResponse.conversation_stage === "BOOKED" ? "booked" : "active",
          lead_intent: botResponse.lead_intent || "LOW",
          contact_type: botResponse.contact_type === 'non_prospect' ? 'non_prospect' : 'prospect',
          primary_goal: botResponse.primary_goal || null,
          conversation_stage: botResponse.conversation_stage || null,
          messages: memory.messages,
          profile_facts: memory.profile_facts,
          running_summary: memory.running_summary,
          followed_up: false,
          followup_count: 0,
          re_engaged: wasFollowedUp,
          pre_followup_stage: preFollowupStageToWrite,
          updated_at: new Date().toISOString(),
          ...(username ? { username: String(username) } : {}),
          ...(profile_name ? { profile_name: String(profile_name) } : {})
        }, "bot_id,customer_id"));

        // ── DEBUG: track review insert result ──────────────────────────────
        let reviewResult = { success: false, error: "no_review_path_hit" };
        let review_id_final = review_id;

        if (finalAction === "SEND_TO_INBOX_REVIEW" || finalAction === "ESCALATE_TO_HUMAN") {
          await sendToSlack(env, {
            customer_id, action: finalAction,
            conversation_stage: botResponse.conversation_stage,
            confidence: botResponse.confidence,
            last_messages: memory.messages.slice(-5),
            bot_messages: dedupedMessages,
            typing_delays: typingDelays,
            bot_reply: joinedReply,
            internal_notes: botResponse.internal_notes,
            review_id: batchReviewId || review_id, auto_send_enabled: autoSendEnabled
          });

          if (batchReviewId) {
            // Batching: update existing pending review with regenerated AI response
            reviewResult = await supabaseUpdate(env, "reviews", batchReviewId, {
              action_type: finalAction,
              conversation_stage: botResponse.conversation_stage || null,
              confidence: (botResponse.situation_clarity * 0.4) + (botResponse.response_quality * 0.6) || botResponse.confidence || null,
              bot_reply: joinedReply,
              bot_messages: dedupedMessages,
              typing_delays: typingDelays,
              internal_notes: (botResponse.internal_notes || "") + " [Batched: multiple lead messages combined]",
              escalation_reason: botResponse.escalation_reason || null,
              emotional_state: botResponse.emotional_state || null,
              last_messages: memory.messages.slice(-5),
              lead_intent: botResponse.lead_intent || "LOW",
              ...(username ? { username: String(username) } : {}),
              ...(profile_name ? { profile_name: String(profile_name) } : {})
            });
            // Use the batch review ID for the response
            review_id_final = batchReviewId;
          } else {
            reviewResult = await supabaseInsert(env, "reviews", {
              id: review_id, bot_id: BOT_ID,
              customer_id: String(customer_id),
              action_type: finalAction,
              conversation_stage: botResponse.conversation_stage || null,
              confidence: (botResponse.situation_clarity * 0.4) + (botResponse.response_quality * 0.6) || botResponse.confidence || null,
              bot_reply: joinedReply,
              bot_messages: dedupedMessages,
              typing_delays: typingDelays,
              internal_notes: botResponse.internal_notes || null,
              escalation_reason: botResponse.escalation_reason || null,
              emotional_state: botResponse.emotional_state || null,
              last_messages: memory.messages.slice(-5),
              status: "pending",
              created_at: new Date().toISOString(),
              ...(username ? { username: String(username) } : {}),
              ...(profile_name ? { profile_name: String(profile_name) } : {})
            });
            review_id_final = review_id;
          }
        }

        // AUTO_SEND — send via Scenario 2 directly + write review record
        if (finalAction === "AUTO_SEND") {
          ctx.waitUntil(sendToMakeScenario2(String(customer_id), dedupedMessages, typingDelays));
          if (batchReviewId) {
            // Batching: update existing review to auto_sent
            reviewResult = await supabaseUpdate(env, "reviews", batchReviewId, {
              action_type: "AUTO_SEND",
              conversation_stage: botResponse.conversation_stage || null,
              confidence: (botResponse.situation_clarity * 0.4) + (botResponse.response_quality * 0.6) || botResponse.confidence || null,
              bot_reply: joinedReply,
              bot_messages: dedupedMessages,
              typing_delays: typingDelays,
              internal_notes: (botResponse.internal_notes || "") + " [Batched: multiple lead messages combined]",
              last_messages: memory.messages.slice(-5),
              status: "auto_sent",
              resolved_at: new Date().toISOString(),
              lead_intent: botResponse.lead_intent || "LOW",
              ...(username ? { username: String(username) } : {}),
              ...(profile_name ? { profile_name: String(profile_name) } : {})
            });
            review_id_final = batchReviewId;
          } else {
            reviewResult = await supabaseInsert(env, "reviews", {
              id: review_id, bot_id: BOT_ID,
              customer_id: String(customer_id),
              action_type: "AUTO_SEND",
              conversation_stage: botResponse.conversation_stage || null,
              confidence: (botResponse.situation_clarity * 0.4) + (botResponse.response_quality * 0.6) || botResponse.confidence || null,
              bot_reply: joinedReply,
              bot_messages: dedupedMessages,
              typing_delays: typingDelays,
              internal_notes: botResponse.internal_notes || null,
              last_messages: memory.messages.slice(-5),
              status: "auto_sent",
              resolved_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              ...(username ? { username: String(username) } : {}),
              ...(profile_name ? { profile_name: String(profile_name) } : {})
            });
            review_id_final = review_id;
          }
        }

        return new Response(JSON.stringify({
          review_id: review_id_final,
          customer_id,
          user_message: message,

          // Always empty — Worker never sends via Scenario 1
          // AUTO_SEND goes via Scenario 2 directly. Manual approval goes via inbox -> Scenario 2
          messages: [],
          typing_delays_ms: [],
          total_delay_ms: 0,
          message_count: 0,

          // Full response for Tester and integrations
          bot_reply: joinedReply,

          conversation_stage: botResponse.conversation_stage,
          decision_type: botResponse.decision_type || null,
          confidence: botResponse.confidence,
          lead_intent: botResponse.lead_intent || "LOW",
          next_action: finalAction,
          auto_send_enabled: autoSendEnabled,
          progression_goal: botResponse.progression_goal || null,
          tags: botResponse.tags || [],
          recent_conversation: memory.messages.slice(-5).map(m => ({
            role: m.role === "user" ? "Lead" : "Bot",
            content: m.content,
            timestamp: new Date(m.timestamp).toLocaleString()
          })),
          timestamp: new Date().toLocaleString(),

          // ── DEBUG INFO (remove after fixing) ──────────────────────────────
          debug: {
            review_insert: reviewResult,
            final_action: finalAction,
            batched: batchReviewId ? true : false,
            batch_review_id: batchReviewId || null,
            auto_send_db_value: botSettings.auto_send_enabled,
            auto_send_resolved: autoSendEnabled,
            bot_suggested_action: botResponse.next_action,
            emotional_state: botResponse.emotional_state,
            escalation_reason: botResponse.escalation_reason || null,
            situation_clarity: botResponse.situation_clarity,
            response_quality: botResponse.response_quality
          }
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (error) {
        console.error("Webhook error:", error);

        // If Claude was overloaded (even after retries) or the network failed,
        // don't drop the lead. Create a placeholder review row so the setter
        // sees the inbound message in the inbox and can reply manually, and
        // fire a Slack alert so Anthony/Nella know in real time.
        if (isOverloadError(error?.message)) {
          try {
            const body = request._cachedBody || null;   // may not exist
            // Reparse the original request body to grab customer_id + message
            let customerId = null, username = null, profileName = null, leadMsg = null;
            try {
              const clone = await request.clone().json();
              customerId = String(clone.customer_id || clone.user_id || "");
              const rawUsername = clone.ig_username || clone.username || null;
              const rawProfile = clone.profile_name || clone.name || null;
              // Row 27: same sanitiser as the main path - reject literal {{...}} placeholders
              const cleanFallback = (v) => {
                if (v === null || v === undefined) return null;
                const s = String(v).trim();
                if (!s) return null;
                if (/^{{[^}]+}}$/.test(s)) return null;
                if (/^(null|undefined|false|none|n\/a)$/i.test(s)) return null;
                return s;
              };
              username = cleanFallback(rawUsername);
              profileName = cleanFallback(rawProfile);
              leadMsg = clone.last_input_text || clone.message || clone.text || null;
            } catch (_) { /* request already consumed, best-effort */ }

            const BOT_ID = "00000000-0000-0000-0000-000000000002";
            if (customerId) {
              ctx.waitUntil(supabaseInsert(env, "reviews", {
                bot_id: BOT_ID,
                customer_id: customerId,
                username: username || null,
                profile_name: profileName || null,
                status: "pending",
                original_reply: "",
                bot_messages: [],
                typing_delays: [],
                conversation_stage: "UNKNOWN",
                confidence: 0,
                lead_intent: "UNKNOWN",
                internal_notes: `[System: Claude API overloaded after 4 attempts. No AI reply generated. Please reply manually. Original error: ${String(error.message).slice(0, 300)}]`,
                created_at: new Date().toISOString()
              }));

              // Also bump conversations.updated_at so the lead surfaces in the inbox
              ctx.waitUntil(supabaseUpsert(env, "conversations", {
                bot_id: BOT_ID,
                customer_id: customerId,
                username: username || null,
                profile_name: profileName || null,
                followed_up: false,
                followup_count: 0,
                updated_at: new Date().toISOString()
              }, "bot_id,customer_id"));
            }

            // Fire-and-forget Slack alert
            if (env.SLACK_WEBHOOK_URL) {
              ctx.waitUntil(fetch(env.SLACK_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: "⚠️ Claude API overloaded - lead routed to inbox for manual reply",
                  blocks: [
                    { type: "header", text: { type: "plain_text", text: "⚠️ Claude API Overloaded" } },
                    { type: "section", fields: [
                      { type: "mrkdwn", text: `*Customer:*\n${customerId || "unknown"}` },
                      { type: "mrkdwn", text: `*Username:*\n${username || "unknown"}` }
                    ]},
                    { type: "section", text: { type: "mrkdwn", text: `*Lead message:*\n${(leadMsg || "(unknown)").slice(0, 400)}` } },
                    { type: "section", text: { type: "mrkdwn", text: `*What happened:*\nClaude returned overload error after 4 retry attempts. A placeholder review has been created in the inbox. Please reply to this lead manually.` } },
                    { type: "section", text: { type: "mrkdwn", text: `*Error:*\n${String(error.message).slice(0, 300)}` } }
                  ]
                })
              }).catch(() => {}));
            }

            // Tell Make the request succeeded, so it doesn't retry and fire a duplicate placeholder
            return new Response(JSON.stringify({
              status: "overload_fallback",
              message: "Claude API overloaded. Lead saved to inbox for manual reply."
            }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          } catch (fallbackErr) {
            console.error("Overload fallback itself failed:", fallbackErr);
            // fall through to the generic 500
          }
        }

        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // /feedback
    if (url.pathname === "/feedback" && request.method === "POST") {
      try {
        const body = await request.json();
        const { review_id, customer_id, original_reply, edited_reply, reason, conversation_stage, situation_context, tags } = body;
        if (!review_id || !customer_id || !edited_reply || !reason) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const feedbackKey = `feedback:${review_id}`;
        const feedbackData = {
          review_id, customer_id, original_reply, edited_reply, reason,
          conversation_stage: conversation_stage || "UNKNOWN",
          situation_context: situation_context || "",
          tags: tags || [],
          timestamp: Date.now(),
          learning_extracted: true
        };
        await env.MEMORY_STORE.put(feedbackKey, JSON.stringify(feedbackData));
        await env.MEMORY_STORE.put(`learning_index:${Date.now()}`, JSON.stringify({
          feedback_key: feedbackKey, stage: conversation_stage, timestamp: Date.now()
        }), { expirationTtl: 90 * 24 * 60 * 60 });

        await sendFeedbackToSlack(env, feedbackData);

        ctx.waitUntil(supabaseInsert(env, "learnings", {
          bot_id: BOT_ID, customer_id: String(customer_id), review_id,
          conversation_stage: conversation_stage || "UNKNOWN",
          situation_context: situation_context || "",
          original_reply: original_reply || "",
          corrected_reply: edited_reply, reason,
          tags: tags || [], source: "inbox",
          created_at: new Date().toISOString()
        }));

        ctx.waitUntil(fetch(`${SUPABASE_URL}/rest/v1/reviews?id=eq.${review_id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            "apikey": env.SUPABASE_SERVICE_KEY,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ status: "edited", final_reply: edited_reply, resolved_at: new Date().toISOString() })
        }));

        return new Response(JSON.stringify({ success: true, message: "Bot learned from your edit!", learning_id: review_id }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (error) {
        console.error("Feedback error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // /train
    if (url.pathname === "/train" && request.method === "POST") {
      try {
        const body = await request.json();
        const { current_prompt, instruction } = body;
        if (!instruction || !current_prompt) {
          return new Response(JSON.stringify({ error: "Missing instruction or current_prompt" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Build the user message — keep prompt and instruction clearly separated
        const userMessage = [
          "CURRENT SYSTEM PROMPT (do not alter structure, only apply the instruction below):",
          "---BEGIN PROMPT---",
          current_prompt,
          "---END PROMPT---",
          "",
          "INSTRUCTION: " + instruction,
          "",
          "Return ONLY a raw JSON object (no markdown fences, no explanation outside the JSON) with these exact keys:",
          '{ "updated_prompt": "...", "explanation": "...", "changes": ["..."], "needs_clarification": false }'
        ].join("\n");

        const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 8000,
            system: "You are a prompt engineering assistant. You receive a system prompt and a plain-English instruction. Make ONLY the requested change. Preserve all formatting. Return a raw JSON object with keys: updated_prompt, explanation, changes (array), needs_clarification (bool). If clarification is needed set needs_clarification to true and add a question key. Output NOTHING except the JSON object — no markdown, no preamble.",
            messages: [
              { role: "user", content: userMessage }
            ],
            temperature: 0.2
          })
        });

        if (!response.ok) throw new Error(`Claude error: ${await response.text()}`);
        const data = await response.json();
        const rawText = data.content[0].text.trim();

        // Strip markdown fences if Claude added them
        const cleanText = rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();

        let parsed;
        try {
          parsed = JSON.parse(cleanText);
        } catch (parseErr) {
          // JSON.parse failed — likely special chars in updated_prompt
          // Return the raw text so the dashboard can still show what changed
          console.error("Train JSON parse error:", parseErr.message);
          return new Response(JSON.stringify({
            error: "parse_error",
            raw_response: cleanText,
            message: "Claude responded but the JSON could not be parsed. The prompt may contain special characters."
          }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        return new Response(JSON.stringify(parsed), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
        console.error("Train error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // /explain-learning
    if (url.pathname === "/explain-learning" && request.method === "POST") {
      try {
        const body = await request.json();
        const { original_reply, corrected_reply, conversation_stage, recent_context } = body;
        if (!original_reply || !corrected_reply) {
          return new Response(JSON.stringify({ error: "Missing original_reply or corrected_reply" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 512,
            system: `You are a sales psychology expert analysing corrections made to an AI appointment setter for a golf fitness coaching business. Explain the psychological reasoning behind the correction so the AI can learn the pattern. Your explanation should: identify the psychological mistake in the original, explain what the corrected version does better, state the pattern for future situations, be 2-4 sentences, focus on NEPQ principles. Return ONLY valid JSON: { "reason": "your explanation" }`,
            messages: [
              { role: "user", content: `Stage: ${conversation_stage || "Unknown"}\nContext:\n${recent_context || "Not provided"}\nOriginal: "${original_reply}"\nCorrected: "${corrected_reply}"` }
            ],
            temperature: 0.4
          })
        });
        if (!response.ok) throw new Error(`Claude error: ${await response.text()}`);
        const data = await response.json();
        const rawText = data.content[0].text;
        const cleanText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleanText);
        return new Response(JSON.stringify(parsed), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
        console.error("Explain-learning error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // /extract-document
    if (url.pathname === "/extract-document" && request.method === "POST") {
      try {
        const body = await request.json();
        const { file_type, file_data } = body;
        if (!file_data || !file_type) {
          return new Response(JSON.stringify({ error: "Missing file_data or file_type" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const binaryStr = atob(file_data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        let content = "";

        if (file_type === "txt") {
          content = new TextDecoder().decode(bytes);
        } else if (file_type === "pdf") {
          const text = new TextDecoder("latin1").decode(bytes);
          const matches = text.match(/\(([^)]{2,200})\)\s*Tj/g) || [];
          const extracted = matches
            .map(m => m.replace(/^\(/, "").replace(/\)\s*Tj$/, ""))
            .map(s => s.replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\\(/g, "(").replace(/\\\)/g, ")"))
            .join(" ");
          if (extracted.length < 100) {
            const fallback = text.match(/[^\x00-\x1F\x7F-\xFF]{4,}/g) || [];
            content = fallback.filter(s => s.length > 4 && !/^[0-9\s.]+$/.test(s)).join(" ");
          } else {
            content = extracted;
          }
        } else if (file_type === "docx") {
          const text = new TextDecoder("latin1").decode(bytes);
          const textRuns = text.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
          if (textRuns.length > 0) {
            content = textRuns.map(t => t.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, "")).join(" ");
          } else {
            content = text.match(/[a-zA-Z0-9\s,.'"\-!?:;()]{10,}/g)?.join(" ") || "";
          }
        } else if (file_type === "xlsx") {
          const text = new TextDecoder("latin1").decode(bytes);
          const sharedStrings = text.match(/<t[^>]*>([^<]+)<\/t>/g) || [];
          if (sharedStrings.length > 0) {
            content = sharedStrings.map(t => t.replace(/<t[^>]*>/, "").replace(/<\/t>/, "")).filter(s => s.trim()).join(" | ");
          } else {
            content = text.match(/[a-zA-Z0-9\s,.'"\-!?:;()]{6,}/g)?.join(" ") || "";
          }
        }

        content = content.replace(/\s{3,}/g, " ").replace(/[^\x20-\x7E\n\r\t]/g, " ").trim();

        if (!content || content.length < 20) {
          return new Response(JSON.stringify({ error: "Could not extract readable text. Try saving as TXT." }), {
            status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ content, word_count: content.split(/\s+/).length }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (error) {
        console.error("Extract-document error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // /learnings
    if (url.pathname === "/learnings" && request.method === "GET") {
      try {
        const allLearnings = await fetchRelevantLearnings(env, {}, 50);
        return new Response(JSON.stringify({ total_learnings: allLearnings.length, learnings: allLearnings }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    // /health
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", learning_enabled: true, supabase_connected: true, documents_enabled: true, multi_message: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};

// Helpers

async function fetchRelevantLearnings(env, memory, limit = 30) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/learnings?bot_id=eq.${BOT_ID}&order=created_at.desc&limit=${limit}`,
      {
        headers: {
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "apikey": env.SUPABASE_SERVICE_KEY
        }
      }
    );
    if (!response.ok) {
      console.error("Error fetching learnings from Supabase:", await response.text());
      return [];
    }
    const data = await response.json();
    return data.map(l => ({
      conversation_stage: l.conversation_stage,
      situation_context: l.situation_context,
      original_reply: l.original_reply,
      edited_reply: l.corrected_reply,
      reason: l.reason,
      tags: l.tags || []
    }));
  } catch (error) {
    console.error("Error fetching learnings:", error);
    return [];
  }
}
__name(fetchRelevantLearnings, "fetchRelevantLearnings");

async function fetchActiveDocuments(env) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_documents?bot_id=eq.${BOT_ID}&status=eq.active&select=name,content,usage_count`,
      {
        headers: {
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "apikey": env.SUPABASE_SERVICE_KEY
        }
      }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error("Error fetching documents:", error);
    return [];
  }
}
__name(fetchActiveDocuments, "fetchActiveDocuments");

async function callClaude(env, memory, learnings = [], documents = [], systemPrompt, model = 'claude-sonnet-4-6', intentDefs = {}, campaignConfig = {}) {
  const lastMessages = (memory.messages || []).slice(-10);

  const learningsSection = learnings && learnings.length > 0 ? `
═══════════════════════════════════════
🚨 SETTER CORRECTIONS - HIGHEST PRIORITY 🚨
═══════════════════════════════════════

CRITICAL: These are REAL corrections made by human setters who reviewed your previous responses.
Before writing ANY reply, check if this situation matches ANY of these corrections.
If it does, APPLY THE PATTERN the setter taught you.

Setter corrections OVERRIDE all default behaviors below.

${learnings.map((l, i) => `
CORRECTION ${i + 1} | Stage: ${l.conversation_stage || "General"}
Situation: ${l.situation_context || "General conversation"}
❌ WRONG: "${l.original_reply}"
✅ RIGHT: "${l.edited_reply}"
🧠 WHY: ${l.reason}
Tags: ${l.tags && l.tags.length > 0 ? l.tags.join(", ") : "None"}
---`).join("\n")}

PATTERNS TO LOOK FOR:
- If setter shortened reply → you were too long
- If setter added empathy → you were too clinical
- If setter removed question → you were moving too fast
- If setter changed question style → yours was too robotic or salesy
- If setter split into multiple messages → do the same in similar situations

These corrections define what good looks like. They are LAW.
═══════════════════════════════════════

` : "";

  const documentSection = documents.length > 0
    ? `\n\n═══════════════════════════════════════
KNOWLEDGE BASE DOCUMENTS - USE AS REFERENCE
═══════════════════════════════════════

The following documents contain information about the coaching program. Reference them when relevant.
Do NOT quote verbatim. Use natural language.

${documents.map((d, i) => `DOCUMENT ${i + 1}: ${d.name}\n${(d.content || "").slice(0, 2000)}${(d.content || "").length > 2000 ? "\n[...truncated]" : ""}`).join("\n\n---\n\n")}

═══════════════════════════════════════\n\n`
    : "";

  // Campaign config injection
  const buyerDesc = campaignConfig.buyerType === 'Emotional'
    ? 'validate feelings first, then facts. Empathy drives action.'
    : campaignConfig.buyerType === 'Logical'
    ? 'lead with outcomes and structure. Skip emotional language.'
    : 'keep it short and value-focused. Make the value obvious quickly.';

  const styleDesc = campaignConfig.commStyle === 'Soft'
    ? 'slow-build rapport. Be warm, patient, non-pushy.'
    : campaignConfig.commStyle === 'Direct'
    ? 'get to the point fast. Short messages. No fluff.'
    : 'balance warmth with directness. Read the lead and adapt.';

  const ab = campaignConfig.aiBehavior || {};
  const hasAvatar = campaignConfig.avatar && campaignConfig.avatar.length > 5;
  const hasAiBehavior = ab.offerName || ab.offerSummary || ab.qualificationCriteria || ab.topPainPoints || hasAvatar;

  const campaignSection = hasAiBehavior
    ? '\n=== AI BEHAVIOR CONFIGURATION ===\n'
    + (ab.aiRole ? 'AI Role: ' + ab.aiRole + '\n' : '')
    + (ab.primaryObjective ? 'Primary Objective: ' + ab.primaryObjective + '\n' : '')
    + (ab.offerName ? 'Offer Name: ' + ab.offerName + '\n' : '')
    + (ab.offerSummary ? 'Offer Summary: ' + ab.offerSummary + '\n' : '')
    + (hasAvatar ? 'Target Avatar: ' + campaignConfig.avatar + '\n' : '')
    + (ab.topPainPoints ? 'Lead Pain Points: ' + ab.topPainPoints + '\n' : '')
    + (ab.desiredOutcomes ? 'Lead Desired Outcomes: ' + ab.desiredOutcomes + '\n' : '')
    + (ab.qualificationCriteria ? 'Strong Lead Criteria: ' + ab.qualificationCriteria + '\n' : '')
    + (ab.disqualifiers ? 'Disqualifiers - do NOT push these leads forward: ' + ab.disqualifiers + '\n' : '')
    + (ab.leadCommStyle ? 'Lead Communication Style: ' + ab.leadCommStyle + ' - automatically adapt your tone, pacing, and detail level to match.\n' : '')
    + '=== END AI BEHAVIOR CONFIG ===\n\n'
    : '';

  const reEngagementSection = memory.re_engagement_context && memory.re_engagement_context.previous_stage ? `
═══════════════════════════════════════
🔄 RE-ENGAGEMENT CONTEXT - CRITICAL
═══════════════════════════════════════

This lead was previously at stage **${memory.re_engagement_context.previous_stage}** before going silent.
A follow-up message was sent. They are now replying after that follow-up.

This is NOT a fresh conversation. They are RESUMING from where they left off.

How to handle this:
- Continue the conversation from the ${memory.re_engagement_context.previous_stage} stage
- Do NOT reset to early stages like HOOK / ENTRY or GOAL
- Do NOT re-ask questions you already asked earlier
- Acknowledge their return briefly if appropriate ("no worries", "all good")
- Move toward the next natural step from ${memory.re_engagement_context.previous_stage}
- Set conversation_stage to ${memory.re_engagement_context.previous_stage} or later, NEVER earlier
- Set lead_intent based on their re-engagement signals - if they're confirming or apologising for the delay, that is MEDIUM or HIGH intent

═══════════════════════════════════════

` : "";

  const welcomeSection = memory.welcome_context ? `
═══════════════════════════════════════
🎯 WELCOME FLOW CONTEXT - READ FIRST
═══════════════════════════════════════

${memory.welcome_context}

═══════════════════════════════════════

` : "";

  const finalSystemPrompt = welcomeSection + reEngagementSection + learningsSection + documentSection + campaignSection + systemPrompt;

  const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 1024,
      system: finalSystemPrompt,
      messages: [
        { role: "user", content: buildDeveloperPrompt(memory, lastMessages) }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }
  const data = await response.json();
  const rawContent = data.content[0].text;
  // Strip any markdown code fences Claude may add
  const cleanContent = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleanContent); }
  catch (e) { throw new Error(`Failed to parse Claude response as JSON: ${rawContent}`); }

  // Support both old (reply only) and new (messages array) response formats
  if (!parsed.messages && !parsed.reply) {
    throw new Error("Claude response missing required fields");
  }
  if (!parsed.conversation_stage || !parsed.next_action) {
    throw new Error("Claude response missing conversation_stage or next_action");
  }

  // Normalise — ensure both fields always exist
  if (!parsed.messages) parsed.messages = [parsed.reply];
  if (!parsed.reply) parsed.reply = parsed.messages.join(" ");

  // Increment usage_count (fire and forget)
  if (documents.length > 0) {
    for (const doc of documents) {
      fetch(`${SUPABASE_URL}/rest/v1/bot_documents?bot_id=eq.${BOT_ID}&name=eq.${encodeURIComponent(doc.name)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "apikey": env.SUPABASE_SERVICE_KEY,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ usage_count: (doc.usage_count || 0) + 1 })
      }).catch(() => {});
    }
  }

  return parsed;
}
__name(callClaude, "callClaude");

async function sendToSlack(env, data) {
  if (!env.SLACK_WEBHOOK_URL) return;
  const actionEmoji = data.action === "ESCALATE_TO_HUMAN" ? "🚨" : "⚠️";
  const autoLabel = data.auto_send_enabled
    ? `Auto-send ON -- confidence ${(data.confidence * 100).toFixed(0)}% | intent ${data.lead_intent || 'unknown'}`
    : `Auto-send OFF -- all messages routed to review`;

  // Show each message separately in Slack with its delay
  const messagesPreview = data.bot_messages && data.bot_messages.length > 1
    ? data.bot_messages.map((msg, i) =>
        `*Message ${i + 1}* _(send after ${(data.typing_delays[i] / 1000).toFixed(1)}s)_:\n${msg}`
      ).join("\n\n")
    : data.bot_reply;

  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${actionEmoji} Review Needed - ${data.action}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `${actionEmoji} ${data.action}` } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Customer:*\n${data.customer_id}` },
          { type: "mrkdwn", text: `*Stage:*\n${data.conversation_stage}` },
          { type: "mrkdwn", text: `*Confidence:*\n${(data.confidence * 100).toFixed(0)}%` },
          { type: "mrkdwn", text: `*Messages:*\n${data.bot_messages?.length || 1} message(s)` }
        ]},
        { type: "section", text: { type: "mrkdwn", text: `*Routing reason:*\n${autoLabel}` } },
        { type: "section", text: { type: "mrkdwn", text: `*Recent Messages:*\n${data.last_messages.map(m => `${m.role === "user" ? "👤" : "🤖"} ${m.content}`).join("\n")}` } },
        { type: "section", text: { type: "mrkdwn", text: `*Bot Reply Draft:*\n${messagesPreview}` } },
        { type: "section", text: { type: "mrkdwn", text: `*Internal Notes:*\n${data.internal_notes || "None"}` } }
      ]
    })
  });
}
__name(sendToSlack, "sendToSlack");

async function sendFeedbackToSlack(env, data) {
  if (!env.SLACK_WEBHOOK_URL) return;
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "🧠 Bot Training - New Learning Captured",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "🧠 Bot Learned Something New!" } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Learning ID:*\n${data.review_id}` },
          { type: "mrkdwn", text: `*Customer:*\n${data.customer_id}` },
          { type: "mrkdwn", text: `*Stage:*\n${data.conversation_stage}` }
        ]},
        { type: "section", text: { type: "mrkdwn", text: `*Situation:*\n${data.situation_context || "General conversation"}` } },
        { type: "section", text: { type: "mrkdwn", text: `*❌ Original Reply:*\n${data.original_reply}` } },
        { type: "section", text: { type: "mrkdwn", text: `*✅ Corrected Reply:*\n${data.edited_reply}` } },
        { type: "section", text: { type: "mrkdwn", text: `*🧠 Why This Matters:*\n${data.reason}` } },
        { type: "section", text: { type: "mrkdwn", text: `*Tags:*\n${data.tags?.length > 0 ? data.tags.join(", ") : "None"}` } }
      ]
    })
  });
}
__name(sendFeedbackToSlack, "sendFeedbackToSlack");

export { index_default as default };
//# sourceMappingURL=index.js.map