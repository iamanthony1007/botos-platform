var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
const BOT_ID = "00000000-0000-0000-0000-000000000002";

// SUPABASE_URL is set per-environment via wrangler.toml [vars] section.
// production: rydkwsjwlgnivlwlvqku.supabase.co (top-level [vars])
// staging:    hpqdoikpjikqjnxotcvi.supabase.co ([env.staging.vars])
// Fallback below preserves production behavior if env.SUPABASE_URL is missing.
function getSupabaseUrl(env) {
  return env.SUPABASE_URL || "https://rydkwsjwlgnivlwlvqku.supabase.co";
}
__name(getSupabaseUrl, "getSupabaseUrl");

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

// Memory fix Option B (2026-06-03): reconcile recent assistant turns in KV
// memory against the authoritative sent text in conversations.messages, so the
// bot sees what the lead actually received (approved/edited drafts AND manual
// replies) instead of its own original draft. Read + in-memory only: the
// reconciled memory is persisted by the EXISTING MEMORY_STORE.put later in the
// turn, so this adds NO new write. Bounded to the recent tail (the window the
// prompt consumes) to hold cost. Never throws: on any error the turn falls back
// to current KV behavior.
function reconcileMemoryWithSentText(memory, dbMessages) {
  const stats = { swapped: 0, merged: 0 };
  try {
    if (!memory || !Array.isArray(memory.messages) || memory.messages.length === 0) return stats;
    if (!Array.isArray(dbMessages) || dbMessages.length === 0) return stats;
    const TAIL = 10;
    const dbTail = dbMessages.slice(-TAIL);

    // 1. Replace KV assistant content with the sent text, matched by review_id
    //    (covers approved and edited drafts). Self-heals stale drafts too.
    const sentByReviewId = new Map();
    for (const dm of dbTail) {
      if (dm && dm.role === "assistant" && dm.review_id) sentByReviewId.set(dm.review_id, dm);
    }
    const start = Math.max(0, memory.messages.length - TAIL);
    for (let i = start; i < memory.messages.length; i++) {
      const km = memory.messages[i];
      if (!km || km.role !== "assistant" || !km.review_id) continue;
      const dm = sentByReviewId.get(km.review_id);
      if (dm && typeof dm.content === "string" && dm.content.length > 0 && dm.content !== km.content) {
        km.content = dm.content;
        if (Array.isArray(dm.bot_messages)) km.bot_messages = dm.bot_messages;
        km.reconciled = true;
        stats.swapped++;
      }
    }

    // 2. Merge manual replies (manual:true, no review_id) that KV never captured,
    //    in timestamp order so the human reply sits correctly in the history.
    const known = new Set(memory.messages.map(m => m && m.timestamp).filter(Boolean));
    const manualToAdd = dbTail.filter(dm =>
      dm && dm.role === "assistant" && dm.manual === true && !dm.review_id &&
      dm.timestamp && !known.has(dm.timestamp)
    );
    if (manualToAdd.length > 0) {
      memory.messages.push(...manualToAdd);
      memory.messages.sort((a, b) => ((a && a.timestamp) || 0) - ((b && b.timestamp) || 0));
      stats.merged = manualToAdd.length;
    }
  } catch (_) { /* fail-safe: never throw the turn */ }
  return stats;
}
__name(reconcileMemoryWithSentText, "reconcileMemoryWithSentText");

// Supabase helpers

async function supabaseInsert(env, table, data) {
  try {
    const response = await fetch(`${getSupabaseUrl(env)}/rest/v1/${table}`, {
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

// Step 3 (2026-04-30): retry wrapper for review/learning inserts.
// Most failures are transient (network blip, brief Supabase hiccup, rate burst).
// Retries: 3 total attempts. Backoff: 200ms, 500ms. Max delay budget ~700ms.
// Returns { success: true } on any successful attempt, or
// { success: false, error, attempts } if all attempts fail.
// Caller is responsible for handling the failure case (alert + KV stash for recovery).
async function supabaseInsertWithRetry(env, table, data, maxAttempts = 3) {
  const delays = [200, 500];   // ms before retry attempt 2 and 3
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await supabaseInsert(env, table, data);
    if (result.success) {
      if (attempt > 1) console.log(`[insert retry] ${table} succeeded on attempt ${attempt}`);
      return { success: true, attempts: attempt };
    }
    lastError = result.error;
    if (attempt < maxAttempts) {
      const delay = delays[attempt - 1] || 500;
      console.warn(`[insert retry] ${table} attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms: ${String(lastError).slice(0, 200)}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  console.error(`[insert retry] ${table} failed after ${maxAttempts} attempts. Last error: ${String(lastError).slice(0, 300)}`);
  return { success: false, error: lastError, attempts: maxAttempts };
}
__name(supabaseInsertWithRetry, "supabaseInsertWithRetry");

async function supabaseUpdate(env, table, id, data) {
  try {
    const response = await fetch(`${getSupabaseUrl(env)}/rest/v1/${table}?id=eq.${id}`, {
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
    const response = await fetch(`${getSupabaseUrl(env)}/rest/v1/${table}?on_conflict=${onConflict}`, {
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

// ── supabaseRpc: call a Postgres function via PostgREST ───────────────────
// Used by the race-safe append_conversation_turn function (migration 004).
// PostgREST exposes any GRANTed function at /rest/v1/rpc/{name}, accepting
// a JSON body with named parameters and returning the function's result.
// Logs result for observability (appended_count, skipped_duplicates, etc).
async function supabaseRpc(env, functionName, args) {
  try {
    const response = await fetch(`${getSupabaseUrl(env)}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "apikey": env.SUPABASE_SERVICE_KEY
      },
      body: JSON.stringify(args)
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Supabase RPC error (${functionName}):`, errText);
      return { ok: false, error: errText };
    }
    const result = await response.json();
    console.log(`[RPC] ${functionName}:`, JSON.stringify(result));
    return { ok: true, result };
  } catch (error) {
    console.error(`Supabase RPC exception (${functionName}):`, error.message);
    return { ok: false, error: error.message };
  }
}
__name(supabaseRpc, "supabaseRpc");

async function getBotSettings(env) {
  try {
    const response = await fetch(
      `${getSupabaseUrl(env)}/rest/v1/bots?id=eq.${BOT_ID}&select=auto_send_enabled,system_prompt,model,intent_definitions,lead_type,buyer_type,communication_style,campaign_goal,target_avatar,ai_behavior_settings,welcome_context,stage_automation`,
      {
        headers: {
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "apikey": env.SUPABASE_SERVICE_KEY
        }
      }
    );
    if (!response.ok) return { auto_send_enabled: false, system_prompt: null, stage_automation: {} };
    const data = await response.json();
    if (!data || data.length === 0) return { auto_send_enabled: false, system_prompt: null, stage_automation: {} };
    return data[0];
  } catch (error) {
    console.error("Error fetching bot settings:", error);
    return { auto_send_enabled: false, system_prompt: null, stage_automation: {} };
  }
}
__name(getBotSettings, "getBotSettings");

// Per-stage human unlock check. A stage auto-sends only when the bot's
// stage_automation jsonb has `enabled: true` for that stage. Absence of
// the stage key, a non-object value, or `enabled: false` all mean NOT
// enabled (the stage stays in setter-review). This is the Layer 1 gate
// of the two-layer model agreed with Nella. Layer 2 (per-message safety)
// continues to be enforced by the rest of resolveNextAction.
function isStageUnlocked(stage, stageAutomation) {
  if (!stage || !stageAutomation || typeof stageAutomation !== "object") return false;
  const entry = stageAutomation[stage];
  return !!(entry && entry.enabled === true);
}
__name(isStageUnlocked, "isStageUnlocked");

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

function resolveNextAction(botResponse, autoSendEnabled, profileFacts = {}, memory = {}, stageAutomation = {}) {
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

  // Master kill switch (global). Stays as the outer gate.
  if (!autoSendEnabled) return "SEND_TO_INBOX_REVIEW";

  // LOW intent always reviews regardless of stage state.
  if (intent === "LOW") return "SEND_TO_INBOX_REVIEW";

  // If the info this message collects is already in profile_facts, review first.
  if (profileFactAlreadyKnown(stage, profileFacts)) return "SEND_TO_INBOX_REVIEW";

  // ── Per-stage human unlock gate (Layer 1 of the two-layer model) ──
  // A draft only auto-sends when its conversation_stage has been explicitly
  // turned on by a human in bots.stage_automation. This closes the prior
  // hole where HIGH intent could auto-send at ANY stage on confidence
  // alone, including closing stages (BOOKED / SCHEDULE / INVITE etc).
  // Now HIGH intent is treated identically to MEDIUM/everything else with
  // respect to per-stage human gating: no unlock = no auto-send.
  if (!isStageUnlocked(stage, stageAutomation)) return "SEND_TO_INBOX_REVIEW";

  // HIGH intent: high confidence required (unchanged thresholds).
  if (intent === "HIGH" && situationClarity >= 0.85 && responseQuality >= 0.90) return "AUTO_SEND";

  // MEDIUM intent: confidence + the existing early-stages whitelist.
  // MEDIUM_INTENT_AUTO_STAGES stays as a defensive guard on top of the
  // stage_automation unlock. A human can enable any stage, but MEDIUM
  // intent traffic is still capped to the early-stages whitelist for
  // robustness. To loosen this for a specific stage, that stage needs
  // both: the human unlock AND inclusion in MEDIUM_INTENT_AUTO_STAGES.
  if (intent === "MEDIUM" && situationClarity >= 0.80 && responseQuality >= 0.85 && MEDIUM_INTENT_AUTO_STAGES.includes(stage)) return "AUTO_SEND";

  // Anything else falls back to setter review.
  return "SEND_TO_INBOX_REVIEW";
}
__name(resolveNextAction, "resolveNextAction");


// Send messages directly to Make Scenario 2.
// Returns { ok: true } on success, or { ok: false, code, plain, technical } on validation failure.
// "ok: false" means we did NOT call Make (pre-flight blocked) and the caller must surface the failure.
async function sendToMakeScenario2(customerId, messages, typingDelays) {
  const id = (customerId === undefined || customerId === null) ? "" : String(customerId).trim();

  // ── Pre-flight validation (Step 2, 2026-04-30) ────────────────────────────
  // Catch invalid customer_ids BEFORE firing the webhook. ManyChat's Instagram
  // subscriber IDs are always all-digit numeric strings of substantial length.
  // Anything else will produce a BundleValidationError downstream.
  if (id.length === 0) {
    console.warn("[Make filter] empty customer_id");
    return { ok: false, code: "empty_customer_id", plain: "Lead ID is missing. Developer contacted.", technical: "customer_id was empty or null" };
  }
  if (/^{{[^}]+}}$/.test(id) || id.includes("{{")) {
    console.warn(`[Make filter] placeholder customer_id: ${id}`);
    return { ok: false, code: "id_contains_placeholder", plain: "ManyChat did not substitute the lead's ID correctly. Developer contacted.", technical: `customer_id contained ManyChat placeholder: ${id}` };
  }
  if (id.startsWith("ghl_")) {
    console.warn(`[Make filter] ghl_-prefixed customer_id: ${id}`);
    return { ok: false, code: "ghl_id_pending_reconciliation", plain: "This lead's ID is not a valid Instagram ID. Developer contacted.", technical: `customer_id "${id}" is a GHL contact ID, not a ManyChat subscriber ID` };
  }
  if (!/^[0-9]+$/.test(id)) {
    console.warn(`[Make filter] non-numeric customer_id: ${id}`);
    return { ok: false, code: "non_numeric_customer_id", plain: "Lead ID format is invalid. Developer contacted.", technical: `customer_id "${id}" contains non-digit characters; ManyChat IG IDs must be numeric` };
  }
  // ManyChat IG subscriber IDs are typically 10-20 digits. We accept 8-22 to be permissive.
  if (id.length < 8) {
    console.warn(`[Make filter] customer_id too short: ${id}`);
    return { ok: false, code: "id_too_short", plain: "Lead ID looks incomplete. Developer contacted.", technical: `customer_id "${id}" is only ${id.length} digits; expected at least 8` };
  }
  if (id.length > 22) {
    console.warn(`[Make filter] customer_id too long: ${id}`);
    return { ok: false, code: "id_too_long", plain: "Lead ID format is invalid. Developer contacted.", technical: `customer_id "${id}" is ${id.length} digits; expected at most 22` };
  }

  // Validation passed - fire the webhook (fire-and-forget, do NOT await ManyChat's downstream call).
  try {
    await fetch("https://hook.eu2.make.com/jknvsf64c05m0urc1f7qph523pi310st", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: id,
        messages: messages,
        typing_delays_ms: typingDelays && typingDelays.length > 0 ? typingDelays : messages.map(() => 1500)
      })
    });
    return { ok: true };
  } catch (e) {
    console.error("Make Scenario 2 error:", e);
    return { ok: false, code: "make_webhook_unreachable", plain: "Could not reach the messaging service. Developer contacted.", technical: `fetch to Make webhook threw: ${e.message}` };
  }
}

// Send a delivery-failure notification email via Resend.
// Fire-and-forget; failure to send the email must never block the Worker response.
async function sendDeliveryFailureEmail(env, payload) {
  if (!env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set; skipping delivery-failure email");
    return;
  }
  const to = env.NOTIFY_EMAIL || "iamanthony1007@gmail.com";
  const subject = `[Mu AI] Auto-send failed — customer ${payload.customer_id || "unknown"}`;
  const lines = [
    `Lead: ${payload.profile_name || payload.username || "(no name)"}${payload.username ? " (@" + payload.username + ")" : ""}`,
    `Customer ID: ${payload.customer_id || "(empty)"}`,
    `Bot ID: ${payload.bot_id}`,
    `Time: ${new Date().toISOString()}`,
    "",
    `Reply that did not send:`,
    `"${(payload.bot_reply || "").slice(0, 1000)}"`,
    "",
    `Plain reason: ${payload.plain_reason}`,
    `Failure code: ${payload.code}`,
    `Technical detail: ${payload.technical_reason}`,
    "",
    `Make Scenario 2 was NOT called (blocked at pre-flight validation).`,
    `Setter sees: red 'AI reply was not sent' banner in the Inbox thread.`,
  ];
  const body = lines.join("\n");
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Mu AI Alerts <onboarding@resend.dev>",
        to: [to],
        subject,
        text: body
      })
    });
    if (!resp.ok) {
      const errTxt = await resp.text();
      console.error(`Resend email failed (${resp.status}):`, errTxt);
    }
  } catch (e) {
    console.error("Resend email exception:", e);
  }
}

// Main Worker

// ---------------------------------------------------------------------------
// Priority 3 (2026-05-12): auto follow-up at T+20h after lead's last message.
// Helpers below are used by the scheduled() handler. See PROGRESS.md for the
// full design. The cron sends a fixed generic line ("Haven't heard back from
// you?") to leads who went quiet between T+20h and T+21h, then records the
// sent message into conversations.messages AND sets followed_up=true,
// followup_count+1, last_followup_source='auto' in ONE atomic, race-safe write
// via the append_followup_turn RPC (migration 008).
//
// History: until 2026-06-10 the message was the lead's first name plus "?"
// (e.g. "James?") and the cron wrote only the followed_up flags via a separate
// PATCH, so the follow-up never appeared in the dashboard thread. Nella asked
// for a generic line; recording the turn was added at the same time.
// ---------------------------------------------------------------------------

// Fixed follow-up line. Single source of truth; swap here (or extend to a
// rotating array) if the wording changes. sanitizeBotMessage strips em dashes
// on the way out, so any future variant stays compliant automatically.
const FOLLOWUP_MESSAGE = "Haven't heard back from you?";

const TESTER_CUSTOMER_IDS = new Set([]);
function isTesterLeadForCron(conv) {
  const cid = String(conv.customer_id || "");
  if (cid.startsWith("soak-")) return true;
  if (cid.startsWith("tester_")) return true;
  if (TESTER_CUSTOMER_IDS.has(cid)) return true;
  const uname = String(conv.username || "").trim().toLowerCase();
  if (/^bot[\s_-]?tester$/i.test(uname)) return true;
  return false;
}
__name(isTesterLeadForCron, "isTesterLeadForCron");

function extractLastUserAndBotMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { lastUserAtMs: null, lastBotAtMs: null, lastMsgRole: null, lastBotText: null, lastUserText: null };
  }
  let lastUserAtMs = null;
  let lastBotAtMs = null;
  let lastBotText = null;
  let lastUserText = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    const role = String(m.role || "").toLowerCase();
    const ts = Number(m.timestamp);
    const tsValid = Number.isFinite(ts) && ts > 0;
    if (role === "user" && lastUserAtMs === null && tsValid) {
      lastUserAtMs = ts;
      lastUserText = typeof m.content === "string" ? m.content : null;
    }
    if ((role === "bot" || role === "assistant") && lastBotAtMs === null) {
      if (tsValid) lastBotAtMs = ts;
      lastBotText = typeof m.content === "string" ? m.content : null;
    }
    if (lastUserAtMs !== null && lastBotAtMs !== null) break;
  }
  const last = messages[messages.length - 1];
  const lastMsgRole = last && typeof last === "object" ? String(last.role || "").toLowerCase() : null;
  return { lastUserAtMs, lastBotAtMs, lastMsgRole, lastBotText, lastUserText };
}
__name(extractLastUserAndBotMessage, "extractLastUserAndBotMessage");

function containsBookingLink(text) {
  if (!text || typeof text !== "string") return false;
  return /jotform\.com|cal\.com\/|calendar\.app\.google|calendly\.com|book(ing)?\s*link/i.test(text);
}
__name(containsBookingLink, "containsBookingLink");

function looksLikeEscalationHandoff(text) {
  if (!text || typeof text !== "string") return false;
  const patterns = [
    /\bI'?ll\s+(get|grab|tell|let)\s+(shaun|the coach|coach\s+shaun)/i,
    /\b(let me|let's)\s+(pass|hand|loop)\s+(you|this)/i,
    /\b(a human|someone from the team|the team will|coach will)\s+(will|can)?\s*(reach out|message you|follow up|be in touch|get back)/i,
    /\bhand(ing)?\s+(you\s+)?(over|off)/i,
    /\bpass(ing)?\s+you\s+(over|on)\s+to/i
  ];
  return patterns.some(re => re.test(text));
}
__name(looksLikeEscalationHandoff, "looksLikeEscalationHandoff");

// ---------------------------------------------------------------------------
// Soft-close guard (2026-06-10). Skips the T+20h nudge for leads who politely
// PARKED the conversation rather than going silent. Two signals, both cheap
// string matching (token-neutral, no Claude call, no extra Supabase reads):
//   1. looksLikeSoftClose(lastBotText): the bot's own last message is a
//      sign-off acknowledgement, e.g. "No worries, enjoy the call. We'll pick
//      this up another time." CRITICAL question gate: a trailing "?" means
//      the bot re-engaged with a question, so a silent lead IS a legitimate
//      nudge target and is NOT treated as a soft close. Production data:
//      about half of "no worries" acks end in a question and must still nudge.
//   2. looksLikeLeadPark(lastUserText): the lead's last message explicitly
//      parked ("about to get on a Teams call, have a nice day") even when the
//      bot re-engaged with a question afterwards.
// Phrase lists are data-grounded from a 60-day production scan (2026-06-10):
// the combined rule suppressed 8/8 genuinely tone-deaf nudges with zero false
// suppressions among fired follow-ups. Deliberately NOT matched because they
// are too generic: bare "later", bare "thanks" / "appreciate it", bare
// "not now". Curly apostrophes (\u2019) are matched because Instagram leads
// often type them.
// ---------------------------------------------------------------------------
function looksLikeSoftClose(text) {
  if (!text || typeof text !== "string") return false;
  // Question gate: the bot asked something and is awaiting a reply.
  if (text.trim().endsWith("?")) return false;
  const patterns = [
    /\bno (worries|rush|pressure|dramas|problem)\b/i,
    /\b(all|sounds) good\b/i,
    /\benjoy (the|your) (call|day|meeting|weekend|rest)\b/i,
    /\bpick (this|it) (back )?up (another time|later|tomorrow|whenever)\b/i,
    /\banother time\b/i,
    /\bwhen(ever)? you(['\u2019]re| are)? ready\b/i,
    /\bwhen the time(['\u2019]s| is) right\b/i,
    /\b(take your|in your own) time\b/i,
    /\b(talk|speak|chat|catch up) (soon|later)\b/i,
    /\breach out (any ?time|whenever)\b/i,
    /\bi['\u2019]?m here (if|when|whenever) you\b/i,
    /\bgood luck\b/i,
    /\ball the best\b/i,
    /\btake care\b/i,
    /\bhave a (nice|good|great) (day|weekend|one|evening)\b/i,
    /free content[\s\S]{0,80}when you(['\u2019]re| are) ready/i
  ];
  return patterns.some(re => re.test(text));
}
__name(looksLikeSoftClose, "looksLikeSoftClose");

function looksLikeLeadPark(text) {
  if (!text || typeof text !== "string") return false;
  const patterns = [
    /\bhave a (nice|good|great) (day|weekend|evening)\b/i,
    /\bon a (teams|zoom|work) call\b/i,
    /\bin a meeting\b/i,
    /\b(get|circle|reach) back to you (later|tomorrow|next week|soon)\b/i,
    /\bpick (this|it) (back )?up (another time|later)\b/i,
    /\b(talk|speak) (soon|later)\b/i,
    /\bbeen (sick|busy|away)\b/i,
    /\bnot (doing much|much) (right now|at the moment)\b/i,
    /\bwill (continue to )?follow\b/i,
    /\bkeep following\b/i,
    /\bnot (right now|at the moment)\b/i,
    /\b(do not|don['\u2019]?t) want to (continue|chat)\b/i
  ];
  return patterns.some(re => re.test(text));
}
__name(looksLikeLeadPark, "looksLikeLeadPark");

function resolveFollowUpName(conv) {
  const pn = String(conv.profile_name || "").trim();
  if (pn.length === 0) return null;

  // Defensive guard: reject profile_name that looks like the username.
  // Catches three cases:
  //   (a) profile_name exactly equals username (e.g. "bradgov313" / "bradgov313")
  //   (b) profile_name's normalised form (lowercased, non-alphanum stripped) equals username's normalised form
  //   (c) profile_name's first word equals username (after lowercasing)
  // Why: even after the Make Scenario 1 mapping was corrected on 2026-05-18,
  // bad data may arrive from other ingestion paths or future regressions.
  // Skipping is better than sending "shank_golf_society?" as a follow-up.
  const un = String(conv.username || "").trim();
  if (un.length > 0) {
    const pnLower = pn.toLowerCase();
    const unLower = un.toLowerCase();
    if (pnLower === unLower) return null;
    const pnNorm = pnLower.replace(/[^a-z0-9]/g, "");
    const unNorm = unLower.replace(/[^a-z0-9]/g, "");
    if (pnNorm.length > 0 && pnNorm === unNorm) return null;
    const firstWordLower = pnLower.split(/\s+/)[0];
    if (firstWordLower === unLower) return null;
  }

  const firstWord = pn.split(/\s+/)[0];
  if (!firstWord || firstWord.length === 0) return null;
  return firstWord.slice(0, 30);
}
__name(resolveFollowUpName, "resolveFollowUpName");

async function runFollowUpCron(env, ctx, now) {
  const MAX_PER_RUN = 50;
  const WINDOW_MIN_MS = 20 * 3600000;
  const WINDOW_MAX_MS = 21 * 3600000;
  const FOLLOWUP_TYPING_DELAY_MS = 1000;

  const lower = new Date(now - WINDOW_MAX_MS).toISOString();
  const upper = new Date(now - WINDOW_MIN_MS).toISOString();

  const stats = {
    examined: 0,
    sent: 0,
    capped: false,
    skipped: {
      no_messages: 0,
      no_user_message: 0,
      last_message_not_bot: 0,
      user_message_outside_window: 0,
      booking_link: 0,
      escalation_handoff: 0,
      soft_close: 0,
      tester: 0,
      no_profile_name: 0,
      make_send_failed: 0
    }
  };

  const baseUrl = `${getSupabaseUrl(env)}/rest/v1/conversations?bot_id=eq.${BOT_ID}&followed_up=eq.false&for_coach=eq.false&conversation_stage=not.eq.BOOKED&updated_at=gte.${lower}&updated_at=lte.${upper}&select=id,customer_id,username,profile_name,messages,conversation_stage&limit=200`;

  let convs = [];
  try {
    const resp = await fetch(baseUrl, {
      headers: {
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "apikey": env.SUPABASE_SERVICE_KEY
      }
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[cron] eligibility query failed: ${resp.status} ${errText.slice(0, 300)}`);
      return { ok: false, error: `eligibility query ${resp.status}`, stats };
    }
    convs = await resp.json();
  } catch (e) {
    console.error(`[cron] eligibility query threw: ${e.message}`);
    return { ok: false, error: e.message, stats };
  }

  console.log(`[cron] window ${lower} to ${upper}; ${convs.length} candidates returned`);

  for (const c of convs) {
    if (stats.sent >= MAX_PER_RUN) {
      stats.capped = true;
      console.warn(`[cron] hit MAX_PER_RUN=${MAX_PER_RUN}; remaining candidates skipped`);
      break;
    }
    stats.examined++;

    if (isTesterLeadForCron(c)) { stats.skipped.tester++; continue; }

    const msgs = c.messages;
    if (!Array.isArray(msgs) || msgs.length === 0) { stats.skipped.no_messages++; continue; }

    const { lastUserAtMs, lastBotAtMs, lastMsgRole, lastBotText, lastUserText } =
      extractLastUserAndBotMessage(msgs);

    if (!lastUserAtMs) { stats.skipped.no_user_message++; continue; }
    if (lastMsgRole !== "bot" && lastMsgRole !== "assistant") {
      stats.skipped.last_message_not_bot++; continue;
    }
    const userMsgAgeMs = now - lastUserAtMs;
    if (userMsgAgeMs < WINDOW_MIN_MS || userMsgAgeMs >= WINDOW_MAX_MS) {
      stats.skipped.user_message_outside_window++; continue;
    }
    if (containsBookingLink(lastBotText)) { stats.skipped.booking_link++; continue; }
    if (looksLikeEscalationHandoff(lastBotText)) { stats.skipped.escalation_handoff++; continue; }

    // Soft-close guard: the lead politely parked, or the bot signed off
    // without a question. A nudge here is tone-deaf. See looksLikeSoftClose.
    if (looksLikeSoftClose(lastBotText) || looksLikeLeadPark(lastUserText)) {
      stats.skipped.soft_close++; continue;
    }

    // Eligibility parity: keep skipping leads with no usable profile_name even
    // though the generic line no longer uses the name. This preserves the EXACT
    // candidate set from the name-based version so this change does not widen
    // who gets nudged. (Could be relaxed later to reach no-profile-name leads;
    // flagged for Nella, do not change without sign-off.)
    if (!resolveFollowUpName(c)) { stats.skipped.no_profile_name++; continue; }

    const sanitized = sanitizeBotMessage(FOLLOWUP_MESSAGE);
    // Cron sends plain strings to match Scenario 2 webhook interface contract.
    // The webhook expects messages: [string], not messages: [{text, typing_delay_ms}].
    // Sending objects causes Make BasicFeeder to emit empty 90.value which fails
    // the Manychat SetSubscriberCustomField step with BundleValidationError.
    const sendResult = await sendToMakeScenario2(
      c.customer_id,
      [sanitized],
      [FOLLOWUP_TYPING_DELAY_MS]
    );

    if (!sendResult || !sendResult.ok) {
      stats.skipped.make_send_failed++;
      console.warn(`[cron] Make send failed for ${c.customer_id}: ${sendResult && sendResult.code}`);
      continue;
    }

    // Record the sent follow-up into conversations.messages AND set the
    // follow-up flags (followed_up=true, followup_count+1, last_followup_source)
    // in ONE atomic, race-safe write via append_followup_turn (migration 008).
    // This replaces the old separate PATCH so there is no PATCH-vs-append race
    // and the message shows in the dashboard thread + the bot's rehydrated
    // memory. The entry carries followup:true, which the dashboard reads to
    // render the distinct "Auto follow-up" tag (it creates no reviews row).
    // CRITICAL: ctx.waitUntil, never bare await (the multi-hour-outage rule).
    const followupEntry = {
      role: "assistant",
      content: sanitized,
      bot_messages: [sanitized],
      typing_delays: [FOLLOWUP_TYPING_DELAY_MS],
      timestamp: Date.now(),
      followup: true,
      followup_source: "auto",
      message_count: 1
    };
    ctx.waitUntil(
      supabaseRpc(env, "append_followup_turn", {
        p_bot_id: BOT_ID,
        p_customer_id: String(c.customer_id),
        p_new_message: followupEntry,
        p_source: "auto"
      }).then(r => {
        if (!r || !r.ok || (r.result && r.result.ok === false)) {
          console.error(`[cron] append_followup_turn failed for ${c.customer_id}: ${JSON.stringify(r && (r.error || r.result) || r)}`);
        }
      }).catch(e => console.error(`[cron] append_followup_turn threw for ${c.customer_id}: ${e.message}`))
    );

    stats.sent++;
    console.log(`[cron] sent follow-up to ${c.customer_id}`);

    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[cron] done. examined=${stats.examined} sent=${stats.sent} skipped=${JSON.stringify(stats.skipped)}`);
  return { ok: true, stats };
}
__name(runFollowUpCron, "runFollowUpCron");

var index_default = {
  async scheduled(event, env, ctx) {
    console.log(`[cron] tick at ${new Date().toISOString()} (cron=${event && event.cron})`);
    try {
      const result = await runFollowUpCron(env, ctx, Date.now());
      console.log(`[cron] result: ok=${result.ok} examined=${result.stats && result.stats.examined} sent=${result.stats && result.stats.sent}`);
    } catch (e) {
      console.error(`[cron] uncaught: ${e && e.message}`);
    }
  },
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

    // Priority 3 (2026-05-12): staging-only manual cron trigger.
    if (url.pathname === "/__cron-test" && request.method === "GET") {
      if (env.ENVIRONMENT !== "staging") {
        return new Response(JSON.stringify({ error: "not available in this environment" }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
      try {
        const result = await runFollowUpCron(env, ctx, Date.now());
        return new Response(JSON.stringify(result, null, 2),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    // /webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const body = await request.json();
        // Step 7 (2026-05-03): also accept lead_source and last_input_text from
        // ManyChat keyword/comment automations. lead_source identifies the entry
        // (e.g. "fit", "bomber", "hipflow"). last_input_text is ManyChat's
        // {{last_input_text}} variable which may be the same as message OR may be
        // the lead's actual prior DM text when a keyword fired. We use the duplicate
        // detection logic below to decide whether to treat this as a fresh user message
        // or as a keyword-only event echoing the prior DM.
        let { customer_id, message, channel = "instagram", username = null, profile_name = null,
              lead_source = null, last_input_text = null } = body;

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
        // Step 7: same sanitization for lead_source and last_input_text - reject placeholders.
        lead_source = cleanField(lead_source);
        last_input_text = cleanField(last_input_text);

        // Step 9 (2026-05-03): also sanitize the message field.
        // Previously we deliberately skipped this, reasoning that an empty
        // message should 400 the request. That produced a real bug: when
        // ManyChat fires a keyword automation for a lead who has never sent
        // a DM (only commented), {{last_input_text}} resolved to nothing
        // and ManyChat sent the literal string "{{last_input_text}}" as the
        // message body. The Worker stored that garbage as a user message
        // and the dashboard rendered chat bubbles containing the placeholder.
        const cleanedMessage = cleanField(message);
        message = cleanedMessage;

        // A "keyword-only event" is when ManyChat fired a keyword/comment
        // automation but the lead has no real DM content. There's nothing
        // for Claude to respond TO in the message-content sense - the
        // engagement IS the lead_source. We substitute lead_source as the
        // message content so the dashboard renders a meaningful bubble (the
        // setter sees what triggered the event), the lead list preview shows
        // it, and Claude has something concrete in the developer prompt.
        const isKeywordOnlyEvent = !message && !!lead_source;
        if (isKeywordOnlyEvent) {
          message = lead_source;
          console.log(`[Step 9] customer_id=${customer_id}: keyword-only event, substituting lead_source="${lead_source}" as message content`);
        }

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
        // Per-stage human unlock map. Empty object = no stages unlocked,
        // which matches the existing manual-review default. Always passed
        // to resolveNextAction so HIGH intent no longer bypasses stage gates.
        const stageAutomation = (botSettings.stage_automation && typeof botSettings.stage_automation === "object")
          ? botSettings.stage_automation
          : {};
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

        // Track messages added to memory.messages during THIS turn only.
        // These are what get APPENDED to conversations.messages via the RPC,
        // instead of overwriting the whole array (race-safe).
        const newTurnMessages = [];

        let memory = memoryData || { messages: [], running_summary: "", profile_facts: {} };

        // ── GHL History Merge ─────────────────────────────────────────────────
        // If this is a new lead (no KV memory) and we have their username,
        // check Supabase for GHL historical conversation data and seed memory with it.
        // This gives the AI and setters full context on returning leads.
        if (!memoryData && username) {
          try {
            const ghlResp = await fetch(
              `${getSupabaseUrl(env)}/rest/v1/conversations?bot_id=eq.${BOT_ID}&username=eq.${encodeURIComponent(username.toLowerCase())}&history_source=eq.ghl_import&select=messages,running_summary,profile_facts,total_messages&limit=1`,
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
              `${getSupabaseUrl(env)}/rest/v1/conversations?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&select=messages,running_summary,profile_facts,total_messages,conversation_stage&limit=1`,
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

        // ── Step 7 (2026-05-03): lead_source event detection ───────────────
        // When ManyChat fires a keyword/comment automation (FIT, BOMBER, etc.),
        // it sends lead_source. Two patterns to handle:
        //
        //   A) Lead is brand new OR genuinely typed the keyword: treat normally.
        //      Push user message, generate reply, store lead_source on conversation.
        //
        //   B) Lead has prior history AND the message we received matches the
        //      latest stored user message (case-insensitive trim). This means
        //      ManyChat fired the keyword automation but {{last_input_text}}
        //      resolved to the lead's PREVIOUS DM (already replied to). We do
        //      NOT want to re-process that old DM. We DO want to acknowledge
        //      the new keyword event.
        //
        // Either way we record the keyword event in memory (and conversations.messages)
        // as a `lead_source_event` entry so the dashboard renders it as a banner
        // and the bot sees it as context.
        const isLeadSourceEvent = !!lead_source && !isTesterInit;
        let isDuplicateOfLastMessage = false;
        if (isLeadSourceEvent && Array.isArray(memory.messages) && memory.messages.length > 0) {
          // Walk backward to find the most recent lead message
          const lastUserMsg = [...memory.messages].reverse().find(m =>
            m && (m.role === 'user' || m.role === 'Lead')
          );
          if (lastUserMsg && lastUserMsg.content) {
            const norm = (s) => String(s || '').trim().toLowerCase();
            if (norm(message) === norm(lastUserMsg.content)) {
              isDuplicateOfLastMessage = true;
              console.log(`[Step 7] lead_source="${lead_source}" event for ${customer_id}: detected duplicate of last user message - will not re-process old DM`);
            }
          }
        }

        if (!isTesterInit) {
          // Insert the lead_source_event marker BEFORE the user message so the
          // banner renders at the correct position in the thread timeline.
          if (isLeadSourceEvent) {
            const leadSourceEntry = {
              role: 'lead_source_event',
              lead_source: lead_source,
              display_text: `Engaged via "${lead_source}"`,
              timestamp: Date.now()
            };
            memory.messages.push(leadSourceEntry);
            newTurnMessages.push(leadSourceEntry);
          }

          // Only push the actual user message if it is NOT a duplicate of the prior one.
          // For duplicate keyword events, the conversation already has that message.
          if (!isDuplicateOfLastMessage) {
            const userEntry = { role: "user", content: message, timestamp: Date.now() };
            memory.messages.push(userEntry);
            newTurnMessages.push(userEntry);
          }
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
              `${getSupabaseUrl(env)}/rest/v1/reviews?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&status=eq.pending&created_at=gte.${sixtySecsAgo}&order=created_at.desc&limit=1`,
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
                `${getSupabaseUrl(env)}/rest/v1/reviews?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&status=eq.pending`,
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

        // Phase D (2026-05-19): semantic retrieval of learnings + documents.
        // Embed the user's most recent message joined with last bot reply (for
        // conversational context) and retrieve top-K semantically matched rows.
        // Falls back gracefully if Voyage is down: queryEmbedding is null and
        // both fetches return empty arrays. Legacy functions retained for rollback.
        const retrievalUserMessage = (memory.messages || [])
          .filter(m => m.role === "user")
          .slice(-1)[0]?.content || message || "";
        const retrievalBotMessage = (memory.messages || [])
          .filter(m => m.role === "assistant")
          .slice(-1)[0]?.content || "";
        const queryText = retrievalBotMessage
          ? `${retrievalBotMessage}\n\nUser response: ${retrievalUserMessage}`
          : retrievalUserMessage;
        const queryEmbedding = await embedQueryText(env, queryText);
        // Phase 2 retrieval fix (2026-06-03): fetch a larger candidate pool,
        // then trim Worker-side to a stage-aware, deduped, reduced set once the
        // lead's prior stage is known (selectStageAwareLearnings, below the
        // priorStage read). The trim runs before the prompt is built, so the
        // extra pool rows cost Supabase bandwidth only, never Claude tokens.
        const [learningsPool, documents] = await Promise.all([
          fetchRelevantLearningsSemantic(env, queryEmbedding, { count: LEARNING_POOL_COUNT }),
          fetchRelevantDocumentsSemantic(env, queryEmbedding)
        ]);
        console.log(`[retrieval] pool=${learningsPool.length} docs=${documents.length} embed_dim=${queryEmbedding?.length || 0} similarity_top=${learningsPool[0]?.similarity?.toFixed(3) || "n/a"}`);

        // Bug 7: Read prior conversation state BEFORE calling Claude.
        // We need to know if the lead was previously followed up and what stage
        // they were at, so we can pass that context to Claude AND override the
        // stage afterward as a safety net.
        let wasFollowedUp = false;
        let priorStage = null;
        let priorPreFollowupStage = null;
        try {
          const priorResp = await fetch(
            `${getSupabaseUrl(env)}/rest/v1/conversations?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&select=followup_count,re_engaged,conversation_stage,pre_followup_stage,messages&limit=1`,
            { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
          );
          if (priorResp.ok) {
            const priorData = await priorResp.json();
            if (priorData && priorData.length > 0) {
              wasFollowedUp = (priorData[0].followup_count || 0) >= 1;
              if (priorData[0].re_engaged === true) wasFollowedUp = true;
              priorStage = priorData[0].conversation_stage || null;
              priorPreFollowupStage = priorData[0].pre_followup_stage || null;
              // Memory fix Option B: reconcile KV assistant turns against the
              // authoritative sent text now that we have the conversation row.
              const recStats = reconcileMemoryWithSentText(memory, priorData[0].messages);
              const dbMsgCount = Array.isArray(priorData[0].messages) ? priorData[0].messages.length : 0;
              console.log(`[memory-reconcile] swapped=${recStats.swapped} mergedManual=${recStats.merged} dbMsgs=${dbMsgCount}`);
            }
          }
        } catch (_) { /* non-fatal */ }

        // Phase 2 retrieval fix (2026-06-03): stage-aware, deduped, reduced
        // selection over the candidate pool now that priorStage is known. This
        // is a read-path-only transform (no Supabase writes, ctx.waitUntil
        // untouched). Fail-open preserved: an empty pool yields an empty set.
        const learnings = selectStageAwareLearnings(learningsPool, priorStage);
        console.log(`[retrieval-select] priorStage=${priorStage || "null"} normalized=${normalizeStage(priorStage) || "null"} pool=${learningsPool.length} selected=${learnings.length}`);

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

        // Step 7 (2026-05-03): lead_source context injection.
        // If a keyword event fired, tell Claude explicitly so the reply is
        // appropriate. The system prompt section is built in callClaude() from
        // memory.lead_source_context. Different framing for fresh leads vs
        // existing leads vs duplicate-DM events.
        // Step 9 (2026-05-03): added is_keyword_only flag. True when the lead
        // engaged via comment/keyword without typing a real DM - the bot
        // should generate a warm opener acknowledging the engagement source.
        // False when the lead sent a real message that also happened to include
        // the keyword - the bot should respond to the actual message content
        // and treat lead_source as metadata about how they came in.
        if (isLeadSourceEvent) {
          memory.lead_source_context = {
            source: lead_source,
            is_duplicate: isDuplicateOfLastMessage,
            is_fresh_lead: totalMsgs <= 2,  // they only have the lead_source_event entry and maybe one earlier message
            is_keyword_only: isKeywordOnlyEvent
          };
        }

        const botResponse = await callClaude(env, memory, learnings, documents, systemPrompt, botModel, intentDefs, campaignConfig, priorStage, isLeadSourceEvent);
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
            /longevity/i,
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
            /hipflow|15min|speedandpower|keyword_power/i,
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
        const finalAction = resolveNextAction(botResponse, autoSendEnabled, memory.profile_facts, memory, stageAutomation);

        const assistantEntry = {
          role: "assistant",
          content: joinedReply,
          bot_messages: dedupedMessages,
          typing_delays: typingDelays,
          timestamp: Date.now(),
          review_id,
          message_count: dedupedMessages.length
        };
        memory.messages.push(assistantEntry);
        // Only persist assistant turn to DB on AUTO_SEND. SEND_TO_INBOX_REVIEW
        // and ESCALATE_TO_HUMAN keep the draft in KV memory only - the DB row
        // gets the assistant turn when (and if) the setter approves it. This
        // mirrors the bug-fix-2026-04-30 behavior using the new append model.
        if (finalAction === "AUTO_SEND") {
          newTurnMessages.push(assistantEntry);
        }

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

        // ── Race-safe conversation write via append_conversation_turn RPC ───
        // Migration 004 (2026-05-07). The Postgres function uses SELECT ... FOR
        // UPDATE row locking to serialize concurrent writes for the same lead.
        // Two webhooks arriving close together each append their turn's
        // messages atomically instead of racing on a full-row replacement.
        //
        // newTurnMessages contains only what was pushed in THIS invocation:
        //   - lead_source_event marker (if isLeadSourceEvent)
        //   - new user message (if not a duplicate)
        //   - new assistant message (only on AUTO_SEND - SEND_TO_INBOX_REVIEW
        //     and ESCALATE keep the assistant draft in KV memory only)
        //
        // The function dedupes by (timestamp, role) against the existing array,
        // so retried webhooks cannot double-append.
        ctx.waitUntil(supabaseRpc(env, "append_conversation_turn", {
          p_bot_id: BOT_ID,
          p_customer_id: String(customer_id),
          p_channel: channel,
          p_new_messages: newTurnMessages,
          // Bug 1 fix: status='booked' only when stage is BOOKED.
          p_status: botResponse.conversation_stage === "BOOKED" ? "booked" : "active",
          p_lead_intent: botResponse.lead_intent || "LOW",
          p_contact_type: botResponse.contact_type === 'non_prospect' ? 'non_prospect' : 'prospect',
          p_primary_goal: botResponse.primary_goal || null,
          p_conversation_stage: botResponse.conversation_stage || null,
          p_profile_facts: memory.profile_facts,
          p_running_summary: memory.running_summary,
          p_re_engaged: wasFollowedUp,
          p_pre_followup_stage: preFollowupStageToWrite,
          // Conditional fields: pass NULL to preserve existing DB value via COALESCE.
          // Step 7 (2026-05-03): only stamp lead_source on actual keyword events.
          p_lead_source: isLeadSourceEvent ? lead_source : null,
          p_lead_source_updated_at: isLeadSourceEvent ? new Date().toISOString() : null,
          p_username: username ? String(username) : null,
          p_profile_name: profile_name ? String(profile_name) : null
        }));

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
            // Step 3 (2026-04-30): use retry wrapper instead of single-attempt insert.
            // If all retries fail, the review is lost from the DB but we still need
            // to make the situation visible to setters and alert the developer.
            reviewResult = await supabaseInsertWithRetry(env, "reviews", {
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

            // Step 3: handle persistent insert failure.
            // 1. Stash full payload in KV so we can recover later.
            // 2. Mark the assistant message in memory.messages with delivery_status="uncertain"
            //    so the Inbox renders the yellow "tracking uncertain" banner.
            // 3. Re-write conversations.messages to override Step 1's filter (which would
            //    otherwise hide the orphan because there is no matching review row).
            // 4. Alert via Slack + email.
            if (!reviewResult.success) {
              const failedPayload = {
                review_id, bot_id: BOT_ID, customer_id: String(customer_id),
                action_type: finalAction,
                bot_reply: joinedReply,
                bot_messages: dedupedMessages,
                typing_delays: typingDelays,
                conversation_stage: botResponse.conversation_stage || null,
                lead_intent: botResponse.lead_intent || "LOW",
                stashed_at: new Date().toISOString(),
                error: String(reviewResult.error).slice(0, 1000)
              };
              try {
                await env.MEMORY_STORE.put(`failed_review:${review_id}`, JSON.stringify(failedPayload), { expirationTtl: 7 * 24 * 60 * 60 });
              } catch (kvErr) {
                console.error(`[Step 3] Failed to stash review ${review_id} in KV:`, kvErr);
              }

              // Mark the assistant message as tracking-uncertain
              const lastAssistantIdx = memory.messages.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0).pop();
              if (lastAssistantIdx !== undefined && lastAssistantIdx >= 0) {
                memory.messages[lastAssistantIdx].delivery_status = "uncertain";
                memory.messages[lastAssistantIdx].delivery_failed_reason = "Couldn't track this reply. Developer notified.";
                memory.messages[lastAssistantIdx].delivery_failed_code = "review_insert_failed";
              }

              // Re-write conversations.messages so the orphan is visible WITH the banner.
              // Step 1 filtered it out for SEND_TO_INBOX_REVIEW; we want it back in for this case.
              ctx.waitUntil(supabaseUpsert(env, "conversations", {
                bot_id: BOT_ID,
                customer_id: String(customer_id),
                messages: memory.messages,
                updated_at: new Date().toISOString()
              }, "bot_id,customer_id"));

              // Fire alerts (fire-and-forget)
              ctx.waitUntil(sendDeliveryFailureEmail(env, {
                customer_id, bot_id: BOT_ID, username, profile_name,
                bot_reply: joinedReply,
                plain_reason: "Review record couldn't be saved. Developer notified.",
                technical_reason: `Review insert failed after ${reviewResult.attempts} attempts. Stashed in KV at failed_review:${review_id}. Last error: ${String(reviewResult.error).slice(0, 500)}`,
                code: "review_insert_failed"
              }));
              if (env.SLACK_WEBHOOK_URL) {
                ctx.waitUntil(fetch(env.SLACK_WEBHOOK_URL, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    text: `⚠️ Review insert failed after retries`,
                    blocks: [
                      { type: "header", text: { type: "plain_text", text: "⚠️ Review Insert Failed" } },
                      { type: "section", fields: [
                        { type: "mrkdwn", text: `*Customer:*\n${customer_id || "(empty)"}` },
                        { type: "mrkdwn", text: `*Username:*\n${username || "(none)"}` },
                        { type: "mrkdwn", text: `*Review ID:*\n${review_id}` },
                        { type: "mrkdwn", text: `*Attempts:*\n${reviewResult.attempts}` }
                      ]},
                      { type: "section", text: { type: "mrkdwn", text: `*Stashed in KV:*\nfailed_review:${review_id} (7-day TTL)` } },
                      { type: "section", text: { type: "mrkdwn", text: `*Error:*\n${String(reviewResult.error).slice(0, 500)}` } },
                      { type: "section", text: { type: "mrkdwn", text: `*Reply that wasn't tracked:*\n${(joinedReply || "").slice(0, 400)}` } }
                    ]
                  })
                }).catch(() => {}));
              }
            }
          }
        }

        // AUTO_SEND — send via Scenario 2 directly + write review record
        if (finalAction === "AUTO_SEND") {
          // Step 2 (2026-04-30): await the validation step so we can detect pre-flight failures.
          // sendToMakeScenario2 returns quickly when validation fails (no network call) and
          // returns after firing the webhook on success. ManyChat's downstream errors are
          // NOT detectable here - those would need a Make error-callback (Step 2.5).
          const sendResult = await sendToMakeScenario2(String(customer_id), dedupedMessages, typingDelays);
          const deliveryFailed = !sendResult.ok;

          // If pre-flight validation failed, mark the assistant message in memory.messages
          // with a delivery_status field so the Inbox can render the "AI reply was not sent" banner.
          if (deliveryFailed) {
            const lastAssistantIdx = memory.messages.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0).pop();
            if (lastAssistantIdx !== undefined && lastAssistantIdx >= 0) {
              memory.messages[lastAssistantIdx].delivery_status = "failed";
              memory.messages[lastAssistantIdx].delivery_failed_reason = sendResult.plain;
              memory.messages[lastAssistantIdx].delivery_failed_code = sendResult.code;
            }
            // Re-write the conversations row with the updated messages array so the failed
            // message becomes visible in the thread (Step 1 filter would otherwise hide it
            // because finalAction is still AUTO_SEND - we want it shown WITH the banner).
            ctx.waitUntil(supabaseUpsert(env, "conversations", {
              bot_id: BOT_ID,
              customer_id: String(customer_id),
              messages: memory.messages,
              updated_at: new Date().toISOString()
            }, "bot_id,customer_id"));

            // Fire alerts (fire-and-forget - never block the response)
            ctx.waitUntil(sendDeliveryFailureEmail(env, {
              customer_id, bot_id: BOT_ID, username, profile_name,
              bot_reply: joinedReply,
              plain_reason: sendResult.plain,
              technical_reason: sendResult.technical,
              code: sendResult.code
            }));
            if (env.SLACK_WEBHOOK_URL) {
              ctx.waitUntil(fetch(env.SLACK_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: `🚫 Auto-send delivery failed`,
                  blocks: [
                    { type: "header", text: { type: "plain_text", text: "🚫 Auto-send Delivery Failed" } },
                    { type: "section", fields: [
                      { type: "mrkdwn", text: `*Customer:*\n${customer_id || "(empty)"}` },
                      { type: "mrkdwn", text: `*Username:*\n${username || "(none)"}` },
                      { type: "mrkdwn", text: `*Code:*\n${sendResult.code}` },
                      { type: "mrkdwn", text: `*Bot ID:*\n${BOT_ID}` }
                    ]},
                    { type: "section", text: { type: "mrkdwn", text: `*Plain reason:*\n${sendResult.plain}` } },
                    { type: "section", text: { type: "mrkdwn", text: `*Technical:*\n${sendResult.technical}` } },
                    { type: "section", text: { type: "mrkdwn", text: `*Reply that did not send:*\n${(joinedReply || "").slice(0, 500)}` } }
                  ]
                })
              }).catch(() => {}));
            }
          }

          // Write the review record. Status reflects whether delivery actually went out.
          const reviewStatus = deliveryFailed ? "delivery_failed" : "auto_sent";
          if (batchReviewId) {
            // Batching: update existing review to auto_sent (or delivery_failed)
            reviewResult = await supabaseUpdate(env, "reviews", batchReviewId, {
              action_type: "AUTO_SEND",
              conversation_stage: botResponse.conversation_stage || null,
              confidence: (botResponse.situation_clarity * 0.4) + (botResponse.response_quality * 0.6) || botResponse.confidence || null,
              bot_reply: joinedReply,
              bot_messages: dedupedMessages,
              typing_delays: typingDelays,
              internal_notes: (botResponse.internal_notes || "") + " [Batched: multiple lead messages combined]" + (deliveryFailed ? ` [Delivery failed: ${sendResult.code}]` : ""),
              last_messages: memory.messages.slice(-5),
              status: reviewStatus,
              resolved_at: new Date().toISOString(),
              lead_intent: botResponse.lead_intent || "LOW",
              ...(username ? { username: String(username) } : {}),
              ...(profile_name ? { profile_name: String(profile_name) } : {})
            });
            review_id_final = batchReviewId;
          } else {
            // Step 3 (2026-04-30): retry wrapper for AUTO_SEND review insert too.
            // The message has already gone out (or been blocked at validation in Step 2),
            // but we still want the review record to be reliably tracked.
            reviewResult = await supabaseInsertWithRetry(env, "reviews", {
              id: review_id, bot_id: BOT_ID,
              customer_id: String(customer_id),
              action_type: "AUTO_SEND",
              conversation_stage: botResponse.conversation_stage || null,
              confidence: (botResponse.situation_clarity * 0.4) + (botResponse.response_quality * 0.6) || botResponse.confidence || null,
              bot_reply: joinedReply,
              bot_messages: dedupedMessages,
              typing_delays: typingDelays,
              internal_notes: (botResponse.internal_notes || "") + (deliveryFailed ? ` [Delivery failed: ${sendResult.code}]` : ""),
              last_messages: memory.messages.slice(-5),
              status: reviewStatus,
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
                id: `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                bot_id: BOT_ID,
                customer_id: customerId,
                action_type: "SEND_TO_INBOX_REVIEW",
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

        // Parse-failure safety net (mirrors the overload path above). When
        // Claude returns text that is not valid JSON (most often a truncated
        // response when output hits max_tokens), do not 500 and drop the lead.
        // Create a placeholder review so the lead surfaces in the inbox and
        // return 200 so Make does not retry and fire a duplicate.
        if (error?.isParseFailure) {
          try {
            let customerId = null, username = null, profileName = null, leadMsg = null;
            try {
              const clone = await request.clone().json();
              customerId = String(clone.customer_id || clone.user_id || "");
              const rawUsername = clone.ig_username || clone.username || null;
              const rawProfile = clone.profile_name || clone.name || null;
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
                id: `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                bot_id: BOT_ID,
                customer_id: customerId,
                action_type: "SEND_TO_INBOX_REVIEW",
                username: username || null,
                profile_name: profileName || null,
                status: "pending",
                original_reply: "",
                bot_messages: [],
                typing_delays: [],
                conversation_stage: "UNKNOWN",
                confidence: 0,
                lead_intent: "UNKNOWN",
                internal_notes: `[System: Claude response failed to parse as JSON (stop_reason=${error.stopReason || "null"}, output_tokens=${error.outputTokens || 0}), likely truncation. Lead message: "${(leadMsg || "(unknown)").slice(0, 300)}". Please reply manually. Raw (truncated): ${String(error.rawContent || "").slice(0, 500)}]`,
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
                  text: "[WARNING] Claude response failed to parse - lead routed to inbox for manual reply",
                  blocks: [
                    { type: "header", text: { type: "plain_text", text: "[WARNING] Claude Parse Failure" } },
                    { type: "section", fields: [
                      { type: "mrkdwn", text: `*Customer:*\n${customerId || "unknown"}` },
                      { type: "mrkdwn", text: `*Username:*\n${username || "unknown"}` }
                    ]},
                    { type: "section", fields: [
                      { type: "mrkdwn", text: `*stop_reason:*\n${error.stopReason || "null"}` },
                      { type: "mrkdwn", text: `*output_tokens:*\n${error.outputTokens || 0}` }
                    ]},
                    { type: "section", text: { type: "mrkdwn", text: `*Lead message:*\n${(leadMsg || "(unknown)").slice(0, 400)}` } },
                    { type: "section", text: { type: "mrkdwn", text: `*What happened:*\nClaude returned text that was not valid JSON (likely truncated at max_tokens). A placeholder review has been created in the inbox. Please reply to this lead manually.` } }
                  ]
                })
              }).catch(() => {}));
            }

            // Tell Make the request succeeded with an empty reply so the
            // downstream Send DM module skips, and Make does not retry.
            return new Response(JSON.stringify({
              bot_reply: "",
              next_action: "SEND_TO_INBOX_REVIEW",
              status: "parse_failure_fallback",
              message: "Claude response could not be parsed. Lead saved to inbox for manual reply."
            }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          } catch (fallbackErr) {
            console.error("Parse-failure fallback itself failed:", fallbackErr);
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

        // Phase F-bugfix (2026-05-22): generate embedding for the learning row
        // so semantic retrieval can find it later. Pre-this-fix learnings had
        // embedding=NULL and were invisible to match_learnings RPC.
        // Embed text strategy: combine original_reply + corrected_reply + reason
        // so the embedding captures the FULL correction pattern (what was wrong,
        // what was right, why) rather than just one field in isolation.
        // The whole embed+insert sequence runs inside ctx.waitUntil so the
        // /feedback response returns quickly to the dashboard.
        ctx.waitUntil((async () => {
          const learningEmbedText = [
            (original_reply || "").trim(),
            (edited_reply || "").trim() ? "Corrected to: " + (edited_reply || "").trim() : "",
            (reason || "").trim() ? "Reason: " + (reason || "").trim() : ""
          ].filter(s => s.length > 0).join("\n\n");
          const learningEmbedding = await embedQueryText(env, learningEmbedText);
          if (!learningEmbedding) {
            console.warn(`[feedback] embedding generation failed for review_id=${review_id}, learning will be stored without embedding and won't be semantically retrievable`);
          } else {
            console.log(`[feedback] embedding generated for review_id=${review_id}, dim=${learningEmbedding.length}`);
          }
          await supabaseInsert(env, "learnings", {
            bot_id: BOT_ID, customer_id: String(customer_id), review_id,
            conversation_stage: conversation_stage || "UNKNOWN",
            situation_context: situation_context || "",
            original_reply: original_reply || "",
            corrected_reply: edited_reply, reason,
            tags: tags || [], source: "inbox",
            embedding: learningEmbedding,
            created_at: new Date().toISOString()
          });
        })());

        ctx.waitUntil(fetch(`${getSupabaseUrl(env)}/rest/v1/reviews?id=eq.${review_id}`, {
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
            system: "You are a prompt engineering assistant. You receive a system prompt and a plain-English instruction. Make ONLY the requested change. Preserve all formatting, especially any '## SECTION_NAME' markdown headers (these are load-bearing, the runtime parses sections by these markers). Return a raw JSON object with keys: updated_prompt, explanation, changes (array), needs_clarification (bool). If clarification is needed set needs_clarification to true and add a question key. Output NOTHING except the JSON object, no markdown, no preamble.",
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

    // /learnings (POST)
    // Phase F-bugfix-2 (2026-05-25): lean endpoint for the Dashboard setter
    // inbox to record a learning WITH a server-generated Voyage embedding.
    // The Dashboard used to insert into learnings directly via supabase-js,
    // which left embedding=NULL so match_learnings could never retrieve the
    // row. The Voyage key lives only in the Worker, so the embedding must be
    // generated here.
    //
    // Unlike /feedback this endpoint is multi-tenant safe: bot_id comes from
    // the request body, not the hardcoded BOT_ID constant. It deliberately
    // does NOT fire the Slack notification, KV writes, or reviews PATCH that
    // /feedback does. Those belong to a different lifecycle. This is purely:
    // validate, embed, insert.
    if (url.pathname === "/learnings" && request.method === "POST") {
      try {
        const body = await request.json();
        const {
          bot_id, customer_id, review_id, conversation_stage,
          situation_context, original_reply, corrected_reply,
          corrected_messages, reason, tags, source
        } = body;

        if (!bot_id || !customer_id || !corrected_reply || !reason) {
          return new Response(JSON.stringify({ error: "Missing required fields: bot_id, customer_id, corrected_reply, reason" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Embed text strategy mirrors /feedback: combine original_reply,
        // corrected_reply, and reason so the vector captures the full
        // correction pattern (what was wrong, what was right, why).
        // The whole embed+insert sequence runs inside ctx.waitUntil so the
        // response returns to the dashboard immediately.
        ctx.waitUntil((async () => {
          const learningEmbedText = [
            (original_reply || "").trim(),
            (corrected_reply || "").trim() ? "Corrected to: " + (corrected_reply || "").trim() : "",
            (reason || "").trim() ? "Reason: " + (reason || "").trim() : ""
          ].filter(s => s.length > 0).join("\n\n");
          const learningEmbedding = await embedQueryText(env, learningEmbedText);
          if (!learningEmbedding) {
            console.warn(`[learnings] embedding generation failed for review_id=${review_id || "null"}, learning will be stored without embedding and won't be semantically retrievable`);
          } else {
            console.log(`[learnings] embedding generated for review_id=${review_id || "null"}, dim=${learningEmbedding.length}`);
          }
          await supabaseInsert(env, "learnings", {
            bot_id, customer_id: String(customer_id), review_id: review_id || null,
            conversation_stage: conversation_stage || "UNKNOWN",
            situation_context: situation_context || "",
            original_reply: original_reply || "",
            corrected_reply,
            corrected_messages: corrected_messages || [],
            reason, tags: tags || [], source: source || "inbox",
            embedding: learningEmbedding,
            created_at: new Date().toISOString()
          });
        })());

        return new Response(JSON.stringify({ success: true, learning_id: review_id || null }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (error) {
        console.error("Learnings POST error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // /learnings
    if (url.pathname === "/learnings" && request.method === "GET") {
      try {
        const allLearnings = await fetchRelevantLearningsLegacy(env, {}, 50);
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

async function fetchRelevantLearningsLegacy(env, memory, limit = 30) {
  try {
    const response = await fetch(
      `${getSupabaseUrl(env)}/rest/v1/learnings?bot_id=eq.${BOT_ID}&order=created_at.desc&limit=${limit}`,
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
__name(fetchRelevantLearningsLegacy, "fetchRelevantLearningsLegacy");

async function fetchRelevantLearningsSemantic(env, queryEmbedding, options = {}) {
  // Semantic retrieval of learnings via pgvector match_learnings RPC.
  // Falls back to empty array if queryEmbedding is null (Voyage failed).
  if (!queryEmbedding) return [];
  const matchThreshold = options.threshold ?? 0.3;
  const matchCount = options.count ?? 8;
  try {
    const response = await fetch(
      `${getSupabaseUrl(env)}/rest/v1/rpc/match_learnings`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "apikey": env.SUPABASE_SERVICE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query_embedding: queryEmbedding,
          target_bot_id: BOT_ID,
          match_threshold: matchThreshold,
          match_count: matchCount
        })
      }
    );
    if (!response.ok) {
      console.error(`[semantic-learnings] RPC failed: ${response.status} ${await response.text()}`);
      return [];
    }
    const data = await response.json();
    return (data || []).map(l => ({
      conversation_stage: l.conversation_stage,
      situation_context: l.situation_context,
      original_reply: l.original_reply,
      edited_reply: l.corrected_reply,
      reason: l.reason,
      tags: l.tags || [],
      similarity: l.similarity
    }));
  } catch (err) {
    console.error(`[semantic-learnings] exception: ${err.message}`);
    return [];
  }
}
__name(fetchRelevantLearningsSemantic, "fetchRelevantLearningsSemantic");

async function fetchActiveDocumentsLegacy(env) {
  try {
    const response = await fetch(
      `${getSupabaseUrl(env)}/rest/v1/bot_documents?bot_id=eq.${BOT_ID}&status=eq.active&select=name,content,usage_count`,
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
__name(fetchActiveDocumentsLegacy, "fetchActiveDocumentsLegacy");

async function fetchRelevantDocumentsSemantic(env, queryEmbedding, options = {}) {
  // Semantic retrieval of documents via pgvector match_documents RPC.
  if (!queryEmbedding) return [];
  const matchThreshold = options.threshold ?? 0.2;
  const matchCount = options.count ?? 2;
  try {
    const response = await fetch(
      `${getSupabaseUrl(env)}/rest/v1/rpc/match_documents`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "apikey": env.SUPABASE_SERVICE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query_embedding: queryEmbedding,
          target_bot_id: BOT_ID,
          match_threshold: matchThreshold,
          match_count: matchCount
        })
      }
    );
    if (!response.ok) {
      console.error(`[semantic-documents] RPC failed: ${response.status} ${await response.text()}`);
      return [];
    }
    const data = await response.json();
    return data || [];
  } catch (err) {
    console.error(`[semantic-documents] exception: ${err.message}`);
    return [];
  }
}
__name(fetchRelevantDocumentsSemantic, "fetchRelevantDocumentsSemantic");

async function callClaude(env, memory, learnings = [], documents = [], systemPrompt, model = 'claude-sonnet-4-6', intentDefs = {}, campaignConfig = {}, priorStage = null, hasLeadSourceEvent = false) {
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

  // Step 7 (2026-05-03): lead_source event context.
  // Step 9 (2026-05-03): rewritten to be source-agnostic. The bot no longer
  // relies on hardcoded keywords (BOMBER, FIT, POWER, etc.) being defined in
  // the system prompt. lead_source is treated as metadata about the entry
  // path. The bot reasons about it generically: it knows the lead engaged
  // via SOME source, and should respond appropriately based on whether they
  // also sent real message content.
  //
  // Four modes:
  //  - keyword-only (lead has no prior history, message IS the source value):
  //      generate a warm opener that acknowledges the engagement without
  //      assuming what the source means
  //  - keyword-only (existing lead): the engagement is a re-trigger; don't
  //      restart, briefly acknowledge and continue
  //  - duplicate (existing lead, prior DM was already replied to): same as
  //      above - don't reprocess the old DM
  //  - normal (existing lead with a real message that contains the keyword):
  //      respond to the actual message content, treat source as metadata only
  const leadSourceSection = memory.lead_source_context ? `
═══════════════════════════════════════
🪝 LEAD SOURCE EVENT - READ FIRST
═══════════════════════════════════════

The lead engaged via the source: "${memory.lead_source_context.source}".
This is metadata about HOW the lead came in (a comment, a keyword, an automation trigger, etc). It is NOT necessarily a direct request from the lead.

${memory.lead_source_context.is_keyword_only && memory.lead_source_context.is_fresh_lead
    ? `MODE: keyword-only fresh lead.
The lead has NO prior conversation history and did not send a real DM. They engaged via a comment, keyword trigger, or automation entry point. Their "message" content is the source value itself, not real text they typed.

How to respond:
- Generate a warm, friendly opener appropriate to a fresh lead
- If the source value gives you a clear hint about their interest (e.g. it's a topic name, body part, training type, or content category), you may use that hint to make the opener more specific
- If the source value is unclear, generic, or just a workflow label (e.g. "User Sent a message/comment early extension"), default to a neutral warm opener
- DO NOT pretend the lead said something they did not say
- DO NOT assume what the source means if it is ambiguous`
    : memory.lead_source_context.is_keyword_only && memory.lead_source_context.is_duplicate
    ? `MODE: keyword-only duplicate event for an existing lead.
The lead has prior conversation history. They commented or used a keyword again, but the system already responded to their last DM. Do not restart. Do not re-process. Briefly acknowledge the new engagement and continue the conversation naturally from the current stage.`
    : memory.lead_source_context.is_keyword_only
    ? `MODE: keyword-only event for an existing lead.
The lead has prior conversation history but only the engagement signal (no new DM content) came through. Briefly acknowledge that they just engaged again, and continue the conversation naturally from the current stage.`
    : memory.lead_source_context.is_duplicate
    ? `MODE: existing lead, duplicate DM event.
The keyword automation fired AND it carried the lead's previous DM as the message text. That DM was already responded to. Do not restart. Do not respond to the old DM as if it were new. Briefly acknowledge they just commented or engaged with the keyword, then continue the conversation naturally from the current stage.`
    : `MODE: existing lead, real message with keyword present.
The lead sent a REAL message that also happened to trigger a keyword automation (their text contains a keyword the system watches for). PRIORITIZE responding to the actual message content. Treat the lead_source as metadata only. Do not respond as if they "used the keyword" - they sent a real message that may have coincidentally contained the word.`}

═══════════════════════════════════════

` : "";

  // Prompt caching (Step caching-1, 2026-05-08): split the system field into a
  // stable prefix that Anthropic can cache (90% read discount, 1.25x write
  // surcharge once per 5-min window) and a per-turn dynamic suffix that
  // changes per lead and is never cached.
  //
  // Static prefix order is intentional:
  //   learningsSection -> documentSection -> campaignSection -> systemPrompt
  // The "below" wording inside the learnings section's "OVERRIDE all default
  // behaviors below" header refers to systemPrompt, so learnings must precede
  // it. campaign and documents sit between them.
  //
  // Dynamic suffix order preserves the "READ FIRST" / "CRITICAL" framing of
  // welcome/leadSource/reEngagement by placing them adjacent to the user
  // message, where Claude's recency weighting compensates for them no longer
  // being at the very top of the system field.
  // Phase F (2026-05-21): parse the bot's system_prompt into named sections
  // and inject only the relevant ones based on the conversation stage.
  // Falls back to identical pre-Phase-F behavior when the prompt has no
  // "## " section markers (parseSystemPrompt returns the whole text under
  // __PRELUDE__ and decideRequestedSections returns just that key).
  const parsedSections = parseSystemPrompt(systemPrompt);
  const requestedNames = decideRequestedSections(
    parsedSections,
    priorStage,
    hasLeadSourceEvent
  );
  const lazyPromptBody = requestedNames
    .map(name => {
      const body = parsedSections[name];
      if (!body) return "";
      if (name === "__PRELUDE__") return body;
      return `## ${name}\n${body}`;
    })
    .filter(s => s && s.length > 0)
    .join("\n\n");

  try {
    console.log(`[phase-f] priorStage=${priorStage || "null"} hasLeadSourceEvent=${hasLeadSourceEvent} sectionsInjected=${requestedNames.join(",")}`);
  } catch (_) { /* non-fatal */ }

  const staticPrefix =
    learningsSection +
    documentSection +
    campaignSection +
    lazyPromptBody;

  const dynamicSuffix =
    welcomeSection +
    leadSourceSection +
    reEngagementSection;

  // Bugfix 2026-05-09: Anthropic rejects empty text content blocks with
  // "system: text content blocks must be non-empty". For existing leads
  // with no welcome injection, no lead_source event, and no re-engagement
  // context, all three suffix sections evaluate to "" and dynamicSuffix
  // is an empty string. Build the system array conditionally so we only
  // emit the dynamic block when it has content. Caching breakpoint stays
  // on staticPrefix in both cases (single block or two blocks), so cache
  // hits work identically.
  const systemBlocks = [
    { type: "text", text: staticPrefix }
  ];
  if (dynamicSuffix && dynamicSuffix.trim().length > 0) {
    systemBlocks.push({ type: "text", text: dynamicSuffix });
  }

  const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2048,
      system: systemBlocks,
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

  // Anthropic telemetry: log stop_reason and output_tokens on every call,
  // before the parse, so a truncation (stop_reason="max_tokens") is visible
  // in Cloudflare tail even when JSON.parse later fails.
  try {
    console.log(`[anthropic] model=${model} stop_reason=${data.stop_reason || "null"} output_tokens=${(data.usage && data.usage.output_tokens) || 0}`);
  } catch (_) { /* non-fatal */ }

  // Prompt caching observability: log the usage block so we can verify cache
  // hits in Cloudflare Worker logs. On a fresh cache: cache_creation_input_tokens > 0
  // and cache_read_input_tokens = 0. On a hit within 5 min: the inverse.
  // Both zero = caching not active (likely prefix below 2048-token minimum
  // or static section drifting per-call).
  try {
    const u = data.usage || {};
    console.log(`[cache] model=${model} input=${u.input_tokens || 0} cache_create=${u.cache_creation_input_tokens || 0} cache_read=${u.cache_read_input_tokens || 0} output=${u.output_tokens || 0}`);
  } catch (_) { /* non-fatal */ }
  const rawContent = data.content[0].text;
  // Strip any markdown code fences Claude may add
  const cleanContent = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleanContent); }
  catch (e) {
    const parseErr = new Error(`Failed to parse Claude response as JSON: ${rawContent}`);
    parseErr.isParseFailure = true;
    parseErr.rawContent = rawContent;
    parseErr.stopReason = data.stop_reason || null;
    parseErr.outputTokens = (data.usage && data.usage.output_tokens) || null;
    throw parseErr;
  }

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
      fetch(`${getSupabaseUrl(env)}/rest/v1/bot_documents?bot_id=eq.${BOT_ID}&name=eq.${encodeURIComponent(doc.name)}`, {
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

async function embedQueryText(env, text) {
  // Embed a query string via Voyage AI for semantic retrieval.
  // Returns 1024-dim float array, or null on failure (graceful degradation).
  // input_type="query" optimizes for retrieval search vs "document" for indexing.
  if (!text || !env.VOYAGE_API_KEY) return null;
  try {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: [text.slice(0, 8000)],
        model: "voyage-4",
        input_type: "query"
      })
    });
    if (!response.ok) {
      console.error(`[voyage] embedding failed: ${response.status} ${await response.text()}`);
      return null;
    }
    const data = await response.json();
    return data?.data?.[0]?.embedding || null;
  } catch (err) {
    console.error(`[voyage] embedding exception: ${err.message}`);
    return null;
  }
}
__name(embedQueryText, "embedQueryText");

// Phase F (2026-05-21): section-marker-aware system prompt assembly.
//
// parseSystemPrompt splits a prompt string into named sections by markdown
// headers. Anything before the first "## " header is the prelude. Each
// "## NAME" header opens a new section that runs until the next header.
//
// decideRequestedSections returns the list of section names to inject based
// on the current conversation stage. Always-on sections load unconditionally;
// lazy sections load per the STAGE_GRAPH below.
//
// Backward compatible: a prompt with no "## " markers parses into a single
// "__PRELUDE__" containing the whole text, and decideRequestedSections
// returns just that key, producing identical behavior to pre-Phase-F.

function parseSystemPrompt(promptText) {
  const sections = {};
  if (!promptText || typeof promptText !== "string") {
    sections.__PRELUDE__ = "";
    return sections;
  }
  const lines = promptText.split(/\r?\n/);
  let currentName = "__PRELUDE__";
  let currentBody = [];
  for (const line of lines) {
    const headerMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headerMatch) {
      sections[currentName] = currentBody.join("\n").trim();
      currentName = headerMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  sections[currentName] = currentBody.join("\n").trim();
  return sections;
}
__name(parseSystemPrompt, "parseSystemPrompt");

// Phase 2 retrieval fix (2026-06-03): stage-aware, deduped, reduced-count
// selection over the match_learnings candidate pool. Runs Worker-side after
// the pool is fetched, so it adds zero Claude tokens (the pool is trimmed
// before the prompt is built) and needs no RPC signature change.
const LEARNING_POOL_COUNT = 15;       // candidate rows fetched from match_learnings
const LEARNING_FINAL_COUNT = 5;       // rows actually injected into the prompt
const LEARNING_DEDUP_THRESHOLD = 0.9; // normalized-text similarity above which a row is a duplicate

// Legacy / variant conversation_stage values mapped to canonical STAGE_GRAPH
// keys. Source-controlled and easy to extend. Confirmed against prod data in
// the Phase 1 retrieval-fix investigation (all variant rows were legacy, from
// an older prompt taxonomy). A null/empty stage is left as-is (untargeted).
const STAGE_NORMALIZATION = {
  "ENTRY & CONTEXT": "HOOK / ENTRY",
  "GOAL IDENTIFICATION": "GOAL",
  "DEPTH & EFFORT CHECK": "DIAGNOSTIC",
  "REALITY CHECK": "DIAGNOSTIC",
  "BOOKING DISCIPLINE": "SCHEDULE",
  "NURTURE & EXIT": "FOLLOW-UP",
  "READINESS FILTER": "INVITE"
};
function normalizeStage(stage) {
  if (!stage) return stage;
  return STAGE_NORMALIZATION[stage] || stage;
}
__name(normalizeStage, "normalizeStage");

function normalizeReplyText(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
__name(normalizeReplyText, "normalizeReplyText");

// Dice coefficient over character bigrams of two normalized strings (0..1).
// Robust for near-identical replies (e.g. the same correction with a one-word
// prefix added). Cheap, no embeddings needed - the RPC does not return vectors.
function textSimilarityRatio(a, b) {
  const x = normalizeReplyText(a);
  const y = normalizeReplyText(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0, totalX = 0, totalY = 0;
  for (const v of bx.values()) totalX += v;
  for (const v of by.values()) totalY += v;
  for (const [g, c] of bx) {
    if (by.has(g)) inter += Math.min(c, by.get(g));
  }
  return (2 * inter) / (totalX + totalY);
}
__name(textSimilarityRatio, "textSimilarityRatio");

// Stage-aware, deduped, reduced-count selection over the candidate pool.
// 1. prefer rows whose normalized stage matches the lead normalized stage,
// 2. fill remaining slots from the rest of the pool in similarity order,
// 3. dedup by normalized corrected_reply (edited_reply) text similarity,
// 4. trim to LEARNING_FINAL_COUNT.
// The pool arrives already ordered by similarity desc from match_learnings.
function selectStageAwareLearnings(pool, priorStage) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const targetStage = normalizeStage(priorStage);
  const isDuplicate = (cand, picked) => {
    for (const p of picked) {
      if (textSimilarityRatio(cand.edited_reply, p.edited_reply) > LEARNING_DEDUP_THRESHOLD) return true;
    }
    return false;
  };
  const selected = [];
  // Pass 1: same normalized stage (only when the target stage is known).
  if (targetStage) {
    for (const cand of pool) {
      if (selected.length >= LEARNING_FINAL_COUNT) break;
      if (normalizeStage(cand.conversation_stage) !== targetStage) continue;
      if (isDuplicate(cand, selected)) continue;
      selected.push(cand);
    }
  }
  // Pass 2: fill from the rest of the pool by similarity order.
  for (const cand of pool) {
    if (selected.length >= LEARNING_FINAL_COUNT) break;
    if (selected.includes(cand)) continue;
    if (isDuplicate(cand, selected)) continue;
    selected.push(cand);
  }
  return selected;
}
__name(selectStageAwareLearnings, "selectStageAwareLearnings");

const STAGE_GRAPH = {
  "HOOK / ENTRY": ["SECTION:STAGE_HOOK_ENTRY", "SECTION:STAGE_GOAL", "SECTION:STAGE_INVITE"],
  "GOAL":         ["SECTION:STAGE_HOOK_ENTRY", "SECTION:STAGE_GOAL", "SECTION:STAGE_DIAGNOSTIC", "SECTION:STAGE_INVITE"],
  "DIAGNOSTIC":   ["SECTION:STAGE_GOAL", "SECTION:STAGE_DIAGNOSTIC", "SECTION:STAGE_INSIGHT", "SECTION:STAGE_INVITE"],
  "INSIGHT":      ["SECTION:STAGE_DIAGNOSTIC", "SECTION:STAGE_INSIGHT", "SECTION:STAGE_PRIORITY", "SECTION:STAGE_INVITE"],
  "PRIORITY":     ["SECTION:STAGE_INSIGHT", "SECTION:STAGE_PRIORITY", "SECTION:STAGE_DECISION", "SECTION:STAGE_INVITE", "SECTION:STAGE_FOLLOWUP"],
  "DECISION":     ["SECTION:STAGE_PRIORITY", "SECTION:STAGE_DECISION", "SECTION:STAGE_INVITE"],
  "INVITE":       ["SECTION:STAGE_DECISION", "SECTION:STAGE_INVITE", "SECTION:STAGE_SCHEDULE"],
  "SCHEDULE":     ["SECTION:STAGE_INVITE", "SECTION:STAGE_SCHEDULE", "SECTION:STAGE_BOOKED"],
  "BOOKED":       ["SECTION:STAGE_SCHEDULE", "SECTION:STAGE_BOOKED"],
  "FOLLOW-UP":    ["SECTION:STAGE_FOLLOWUP", "SECTION:NURTURE_EXIT", "SECTION:STAGE_DIAGNOSTIC", "SECTION:STAGE_INVITE"]
};

const ALWAYS_ON_SECTIONS = [
  "PERSONA",
  "VOICE",
  "ICP",
  "INTENT_CLASSIFICATION",
  "GUARDRAILS"
];

function decideRequestedSections(parsedSections, priorStage, hasLeadSourceEvent) {
  const requested = [];

  if (parsedSections.__PRELUDE__ && parsedSections.__PRELUDE__.length > 0) {
    requested.push("__PRELUDE__");
  }

  for (const name of ALWAYS_ON_SECTIONS) {
    if (parsedSections[name]) requested.push(name);
  }

  const stageKey = priorStage && STAGE_GRAPH[priorStage] ? priorStage : "HOOK / ENTRY";
  const stageSections = STAGE_GRAPH[stageKey] || STAGE_GRAPH["HOOK / ENTRY"];
  for (const name of stageSections) {
    if (parsedSections[name] && !requested.includes(name)) {
      requested.push(name);
    }
  }

  if (hasLeadSourceEvent && parsedSections["SECTION:LEAD_SOURCE_EVENT"]) {
    if (!requested.includes("SECTION:LEAD_SOURCE_EVENT")) {
      requested.push("SECTION:LEAD_SOURCE_EVENT");
    }
  }

  if (stageKey === "FOLLOW-UP" && parsedSections["SECTION:NURTURE_EXIT"]) {
    if (!requested.includes("SECTION:NURTURE_EXIT")) {
      requested.push("SECTION:NURTURE_EXIT");
    }
  }

  return requested;
}
__name(decideRequestedSections, "decideRequestedSections");

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

// ============================================================================
// Token encryption helpers (AES-256-GCM, Web Crypto).
// Encrypts per-account access tokens before storing them in
// connected_accounts.access_token_encrypted, and decrypts on read. Key is the
// Worker secret TOKEN_ENCRYPTION_KEY (base64 of 32 random bytes). A random
// 12-byte IV is generated per encryption and packed in front of the ciphertext,
// so the stored blob is self-describing.
// ============================================================================
function encBytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function encBase64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptToken(plaintext, env) {
  const keyBytes = encBase64ToBytes(env.TOKEN_ENCRYPTION_KEY);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return encBytesToBase64(packed);
}

async function decryptToken(blob, env) {
  const keyBytes = encBase64ToBytes(env.TOKEN_ENCRYPTION_KEY);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const packed = encBase64ToBytes(blob);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}