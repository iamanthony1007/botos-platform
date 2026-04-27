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

// Em-dash sanitizer. Replaces em-dash, en-dash, double-hyphen and
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

// Already-asked question check. Returns true if the proposed reply
// is too similar (>= 70% token overlap) to any assistant message in the last 10 turns.
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
  if (proposedTokens.size < 3) return false;

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

// fetchWithRetry — exponential backoff on transient errors
async function fetchWithRetry(url, opts, maxAttempts = 4) {
  const RETRY_STATUS = [429, 502, 503, 504, 529];
  const RETRY_ERROR_TYPES = ["overloaded_error", "rate_limit_error", "api_error"];
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, opts);

      if (RETRY_STATUS.includes(response.status) && attempt < maxAttempts) {
        const body = await response.text();
        console.warn(`[retry] ${url} attempt ${attempt}/${maxAttempts} got ${response.status}: ${body.slice(0, 200)}`);
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

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

      return response;
    } catch (networkErr) {
      lastResponse = null;
      console.warn(`[retry] ${url} attempt ${attempt}/${maxAttempts} network error: ${networkErr.message}`);
      if (attempt === maxAttempts) {
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

function isClaudeOverloaded(error) {
  if (!error) return false;
  const msg = String(error.message || error).toLowerCase();
  return msg.includes("overloaded") || msg.includes("529") || msg.includes("rate_limit") || msg.includes("network_error");
}
__name(isClaudeOverloaded, "isClaudeOverloaded");

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
      `${SUPABASE_URL}/rest/v1/bots?id=eq.${BOT_ID}&select=auto_send_enabled,system_prompt,model,intent_definitions,lead_type,buyer_type,communication_style,campaign_goal,target_avatar,ai_behavior_settings`,
      { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
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

const MEDIUM_INTENT_AUTO_STAGES = ["HOOK / ENTRY", "GOAL", "FOLLOW-UP"];

const STAGE_FACT_REQUIREMENTS = {
  "GOAL":       "primary_goal",
  "DIAGNOSTIC": "what_theyve_tried",
  "INSIGHT":    "current_approach_working",
  "PRIORITY":   "primary_goal",
  "INVITE":     "primary_goal",
};

function profileFactAlreadyKnown(stage, profileFacts) {
  const requiredFact = STAGE_FACT_REQUIREMENTS[stage];
  if (!requiredFact) return false;
  const value = profileFacts?.[requiredFact];
  return value && String(value).trim().length > 0;
}
__name(profileFactAlreadyKnown, "profileFactAlreadyKnown");

function resolveNextAction(botResponse, autoSendEnabled, profileFacts, memory) {
  const action = botResponse.next_action || "SEND_TO_INBOX_REVIEW";
  const stage = botResponse.conversation_stage || "";
  const intent = botResponse.lead_intent || "LOW";

  if (action === "ESCALATE_TO_HUMAN") return "ESCALATE_TO_HUMAN";
  if (!autoSendEnabled) return "SEND_TO_INBOX_REVIEW";
  if (intent === "LOW") return "SEND_TO_INBOX_REVIEW";

  if (intent === "MEDIUM") {
    if (!MEDIUM_INTENT_AUTO_STAGES.includes(stage)) return "SEND_TO_INBOX_REVIEW";
    if (profileFactAlreadyKnown(stage, profileFacts)) return "SEND_TO_INBOX_REVIEW";
    return "AUTO_SEND";
  }

  if (intent === "HIGH") {
    if (["INVITE", "SCHEDULE", "BOOKED", "DECISION"].includes(stage)) return "SEND_TO_INBOX_REVIEW";
    if (profileFactAlreadyKnown(stage, profileFacts)) return "SEND_TO_INBOX_REVIEW";
    return "AUTO_SEND";
  }

  return "SEND_TO_INBOX_REVIEW";
}
__name(resolveNextAction, "resolveNextAction");

async function sendToMakeScenario2(customerId, messages, typingDelays) {
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
__name(sendToMakeScenario2, "sendToMakeScenario2");

async function fetchRelevantLearnings(env, memory, limit = 30) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/learnings?bot_id=eq.${BOT_ID}&order=created_at.desc&limit=${limit}`,
      { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
    );
    if (!response.ok) { console.error("Error fetching learnings:", await response.text()); return []; }
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
      { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
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

function buildDeveloperPrompt(memory, lastMessages) {
  const profileFactsStr = memory.profile_facts && Object.keys(memory.profile_facts).length > 0
    ? Object.entries(memory.profile_facts).map(([k, v]) => `${k}: ${v}`).join("\n")
    : "None collected yet";

  const summaryStr = memory.running_summary || "No summary yet";
  const ghlNote = memory.ghl_history_loaded
    ? `\n[Historical GHL context loaded: ${memory.ghl_total_messages || 0} total messages in CRM history]`
    : "";
  const recoveredNote = memory.recovered_from_supabase
    ? `\n[Memory rehydrated from Supabase — lead has prior conversation history]`
    : "";

  const conversationStr = lastMessages.map(m =>
    `${m.role === "user" ? "LEAD" : "BOT"}: ${m.content}`
  ).join("\n");

  return `CONVERSATION SUMMARY:
${summaryStr}${ghlNote}${recoveredNote}

KNOWN PROFILE FACTS:
${profileFactsStr}

RECENT CONVERSATION:
${conversationStr}

RESPOND WITH VALID JSON ONLY. No markdown. No explanation. Just the JSON object.

Required fields:
{
  "reply": "single joined string of all messages",
  "messages": ["message 1", "message 2"],
  "conversation_stage": "one of: HOOK / ENTRY | GOAL | DIAGNOSTIC | INSIGHT | PRIORITY | DECISION | INVITE | SCHEDULE | BOOKED | FOLLOW-UP",
  "lead_intent": "LOW | MEDIUM | HIGH",
  "next_action": "AUTO_SEND | SEND_TO_INBOX_REVIEW | ESCALATE_TO_HUMAN",
  "internal_notes": "your analysis of situation, what stage we are at, what the lead needs next — NO em dashes",
  "escalation_reason": null,
  "emotional_state": "NEUTRAL | INTERESTED | OBJECTING | EXCITED | COLD",
  "situation_clarity": 0.0-1.0,
  "response_quality": 0.0-1.0,
  "confidence": 0.0-1.0,
  "primary_goal": "what the lead wants to achieve",
  "progression_goal": "what we want the lead to do next",
  "tags": [],
  "memory_update": {
    "profile_facts": {},
    "running_summary": "updated summary"
  }
}

Rules:
- Check setter corrections FIRST before responding
- Move through stages based on what has been established, not linearly
- NEVER mention pricing, program details, or provide coaching advice
- NEVER give workouts or exercises in DMs
- NEVER repeat anything already said earlier in this conversation
- NO em dashes (— or –) anywhere in your response
- The "reply" field must equal all messages joined with a space (for logging)

Focus on: What do they want. What have they tried. Is it working. Is this a priority now.`;
}
__name(buildDeveloperPrompt, "buildDeveloperPrompt");

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
Tags: ${l.tags && l.tags.length > 0 ? l.tags.join(", ") : "None"}`).join("\n")}

═══════════════════════════════════════
END OF SETTER CORRECTIONS
═══════════════════════════════════════
` : "";

  const documentSection = documents && documents.length > 0 ? `
═══════════════════════════════════════
📚 KNOWLEDGE BASE DOCUMENTS
═══════════════════════════════════════
${documents.map(d => `Document: ${d.name}\n${d.content}`).join("\n\n")}
═══════════════════════════════════════
END OF DOCUMENTS
═══════════════════════════════════════
` : "";

  const ab = campaignConfig.aiBehavior || {};
  const hasAvatar = campaignConfig.avatar && campaignConfig.avatar.trim().length > 0;
  const campaignSection = (ab && Object.keys(ab).length > 0) ? `
=== AI BEHAVIOR CONFIG ===
` + (ab.aiRole ? 'AI Role: ' + ab.aiRole + '\n' : '')
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
    : "";

  const finalSystemPrompt = learningsSection + documentSection + campaignSection + systemPrompt;

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
      messages: [{ role: "user", content: buildDeveloperPrompt(memory, lastMessages) }],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }
  const data = await response.json();
  const rawContent = data.content[0].text;
  const cleanContent = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleanContent); }
  catch (e) { throw new Error(`Failed to parse Claude response as JSON: ${rawContent}`); }

  if (!parsed.messages && !parsed.reply) throw new Error("Claude response missing required fields");
  if (!parsed.conversation_stage || !parsed.next_action) throw new Error("Claude response missing conversation_stage or next_action");

  if (!parsed.messages) parsed.messages = [parsed.reply];
  if (!parsed.reply) parsed.reply = parsed.messages.join(" ");

  // Increment document usage_count (fire and forget)
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
  const message = {
    text: `${actionEmoji} Review Needed - ${data.action}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${actionEmoji} ${data.action}` } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Customer:*\n${data.customer_id}` },
          { type: "mrkdwn", text: `*Stage:*\n${data.conversation_stage}` },
          { type: "mrkdwn", text: `*Confidence:*\n${((data.confidence || 0) * 100).toFixed(0)}%` },
          { type: "mrkdwn", text: `*Review ID:*\n${data.review_id}` }
        ]
      },
      { type: "section", text: { type: "mrkdwn", text: `*Recent Messages:*\n${(data.last_messages || []).map(m => `${m.role === "user" ? "👤" : "🤖"} ${m.content}`).join("\n")}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Bot Reply Draft:*\n${data.bot_reply}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Internal Notes:*\n${data.internal_notes || "None"}` } }
    ]
  };
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message)
  });
}
__name(sendToSlack, "sendToSlack");

async function sendFeedbackToSlack(env, data) {
  if (!env.SLACK_WEBHOOK_URL) return;
  const message = {
    text: "🧠 Bot Training - New Learning Captured",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🧠 Bot Learned Something New!" } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Learning ID:*\n${data.review_id}` },
          { type: "mrkdwn", text: `*Customer:*\n${data.customer_id}` },
          { type: "mrkdwn", text: `*Stage:*\n${data.conversation_stage}` }
        ]
      },
      { type: "section", text: { type: "mrkdwn", text: `*Situation:*\n${data.situation_context || "General conversation"}` } },
      { type: "section", text: { type: "mrkdwn", text: `*❌ Original Reply:*\n${data.original_reply}` } },
      { type: "section", text: { type: "mrkdwn", text: `*✅ Corrected Reply:*\n${data.edited_reply}` } },
      { type: "section", text: { type: "mrkdwn", text: `*🧠 Why This Matters:*\n${data.reason}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Tags:*\n${data.tags && data.tags.length > 0 ? data.tags.join(", ") : "None"}` } }
    ]
  };
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message)
  });
}
__name(sendFeedbackToSlack, "sendFeedbackToSlack");

// ─── Main Worker ──────────────────────────────────────────────────────────────
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

    // ── /webhook ──────────────────────────────────────────────────────────────
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const body = await request.json();
        let { customer_id, message, channel = "instagram", username = null, profile_name = null } = body;

        const cleanField = (v) => {
          if (v === null || v === undefined) return null;
          const s = String(v).trim();
          if (!s) return null;
          if (/^{{[^}]+}}$/.test(s)) return null;
          if (/^(null|undefined|false|none|n\/a)$/i.test(s)) return null;
          return s;
        };
        username = cleanField(username);
        profile_name = cleanField(profile_name);

        if (!customer_id || !message) {
          return new Response(JSON.stringify({ error: "Missing customer_id or message" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

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
          }
        }

        // ── Supabase conversations fallback (KV eviction recovery) ────────────
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
          }
        }

        const isTesterInit = message === "__tester_init__";
        if (!isTesterInit) {
          memory.messages.push({ role: "user", content: message, timestamp: Date.now() });
          if (memory.messages.length > 15) memory.messages = memory.messages.slice(-15);
        }

        // ── Message batching (60s window) ─────────────────────────────────────
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
                console.log(`Batching: found recent pending review ${batchReviewId} for ${customer_id}`);
                const lastAssistantIdx = memory.messages.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i >= 0).pop();
                if (lastAssistantIdx !== undefined && lastAssistantIdx >= 0) {
                  memory.messages.splice(lastAssistantIdx, 1);
                }
              }
            }
          } catch (batchErr) {
            console.error("Batch check error:", batchErr);
          }

          // Auto-discard stale pending reviews
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
              if (discardResp.ok) console.log(`Auto-discarded old pending reviews for ${customer_id}`);
            } catch (discardErr) {
              console.error("Auto-discard error:", discardErr);
            }
          }
        }

        const [learnings, documents] = await Promise.all([
          fetchRelevantLearnings(env, memory),
          fetchActiveDocuments(env)
        ]);

        let botResponse;
        try {
          botResponse = await callClaude(env, memory, learnings, documents, systemPrompt, botModel, intentDefs, campaignConfig);
          if (!botResponse || (!botResponse.reply && !botResponse.messages)) throw new Error("Invalid bot response structure");
        } catch (error) {
          // Claude overload fallback — create placeholder review so lead isn't dropped
          if (isClaudeOverloaded(error)) {
            const customerId = customer_id;
            const leadMsg = message;
            const placeholderId = `review_${Date.now()}_overload`;
            ctx.waitUntil(supabaseInsert(env, "reviews", {
              id: placeholderId,
              bot_id: BOT_ID,
              customer_id: String(customerId),
              action_type: "ESCALATE_TO_HUMAN",
              status: "pending",
              bot_reply: "[Claude API overloaded — please reply to this lead manually]",
              bot_messages: ["[Claude API overloaded — please reply to this lead manually]"],
              internal_notes: `[System: Claude API was overloaded after 4 retry attempts. Lead message: "${String(leadMsg).slice(0, 300)}". No AI reply generated. Please reply manually. Original error: ${String(error.message).slice(0, 300)}]`,
              created_at: new Date().toISOString()
            }));
            ctx.waitUntil(supabaseUpsert(env, "conversations", {
              bot_id: BOT_ID,
              customer_id: customerId,
              username: username || null,
              profile_name: profile_name || null,
              followed_up: false,
              followup_count: 0,
              updated_at: new Date().toISOString()
            }, "bot_id,customer_id"));
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
                    { type: "section", text: { type: "mrkdwn", text: `*Error:*\n${String(error.message).slice(0, 300)}` } }
                  ]
                })
              }).catch(() => {}));
            }
            return new Response(JSON.stringify({ status: "overload_fallback", message: "Claude API overloaded. Lead saved to inbox for manual reply." }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          throw error;
        }

        // Sanitize internal_notes (AI Insight panel)
        if (botResponse.internal_notes) {
          botResponse.internal_notes = sanitizeBotMessage(botResponse.internal_notes);
        }

        // Multi-message normalisation
        const rawMessages = Array.isArray(botResponse.messages) && botResponse.messages.length > 0
          ? botResponse.messages
          : [botResponse.reply];

        const dedupedMessagesRaw = rawMessages.filter((msg, idx, arr) =>
          arr.findIndex(m => m.trim().toLowerCase() === msg.trim().toLowerCase()) === idx
        );

        const dedupedMessages = dedupedMessagesRaw
          .map(m => sanitizeBotMessage(m))
          .filter(m => m && m.length > 0);

        const typingDelays = dedupedMessages.map(msg => calcTypingDelay(msg));
        const totalDelay = typingDelays.reduce((a, b) => a + b, 0);
        const joinedReply = dedupedMessages.join(" ");

        // Repeated-question guard
        const alreadyAsked = hasBotAlreadyAsked(joinedReply, memory);
        if (alreadyAsked) {
          botResponse.next_action = "SEND_TO_INBOX_REVIEW";
          botResponse.internal_notes = (botResponse.internal_notes || "") +
            " [System: Repeated-question guard triggered - bot was about to ask something already asked in the last 10 turns]";
        }

        // Intent classification from lead's actual message
        const lastUserMessage = (message || "").toLowerCase();
        const stage = (botResponse.conversation_stage || "").toUpperCase();

        function classifyIntentFromLeadMessage(msg, stage) {
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
          const lowSignals = [
            /just curious|just browsing|just looking/i,
            /maybe later|sometime this year|eventually/i,
            /start with free|free content first|what do you suggest first/i,
            /hipflow|15min|speedandpower/i,
            /saw your post/i,
            /not sure yet|just exploring/i
          ];
          const mediumSignals = [
            /improve consistency|more distance|reduce pain|move better/i,
            /interested in your program|wanted more info|heard about/i,
            /how much does it cost|what are the fees|how does it work|what does it involve/i,
            /I.d like to|I would like to|I want to work on/i
          ];

          if (["SCHEDULE", "BOOKED"].includes(stage)) return "HIGH";
          if (stage === "FOLLOW-UP") return "LOW";
          if (stage === "INVITE") return "MEDIUM";

          const isHigh = highSignals.some(r => r.test(msg));
          const isMedium = !isHigh && mediumSignals.some(r => r.test(msg));
          const isLow = lowSignals.some(r => r.test(msg));

          if (isHigh) return "HIGH";
          if (isMedium) return "MEDIUM";
          if (isLow) return "LOW";
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

        const userMessageCount = memory.messages.filter(m => m.role === "user").length;
        if (userMessageCount <= 1 && botResponse.lead_intent === "HIGH" && detectedIntent !== "HIGH") {
          botResponse.lead_intent = "LOW";
          botResponse.internal_notes = (botResponse.internal_notes || "") + " [System: Intent reset to LOW - first message, no high-intent signals detected]";
        }

        // Stage guardrail
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

        // Memory update
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

        if (botResponse.emotional_state === "OBJECTING") {
          memory.objection_count = (memory.objection_count || 0) + 1;
        }

        await env.MEMORY_STORE.put(`memory:${customer_id}`, JSON.stringify(memory));

        // ── FIX: Preserve followup_count — do NOT reset to 0 on every message ──
        // Read the existing count first, then write it back unchanged.
        let wasFollowedUp = false;
        let priorFollowupCount = 0;
        try {
          const priorResp = await fetch(
            `${SUPABASE_URL}/rest/v1/conversations?bot_id=eq.${BOT_ID}&customer_id=eq.${encodeURIComponent(String(customer_id))}&select=followup_count,re_engaged&limit=1`,
            { headers: { "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`, "apikey": env.SUPABASE_SERVICE_KEY } }
          );
          if (priorResp.ok) {
            const priorData = await priorResp.json();
            if (priorData && priorData.length > 0) {
              priorFollowupCount = priorData[0].followup_count || 0;
              wasFollowedUp = priorFollowupCount >= 1 || priorData[0].re_engaged === true;
            }
          }
        } catch (_) { /* non-fatal, default to 0 */ }

        ctx.waitUntil(supabaseUpsert(env, "conversations", {
          bot_id: BOT_ID,
          customer_id: String(customer_id),
          channel,
          status: botResponse.conversation_stage === "BOOKED" ? "booked" : "active",
          lead_intent: botResponse.lead_intent || "LOW",
          primary_goal: botResponse.primary_goal || null,
          conversation_stage: botResponse.conversation_stage || null,
          messages: memory.messages,
          profile_facts: memory.profile_facts,
          running_summary: memory.running_summary,
          followed_up: wasFollowedUp,
          followup_count: priorFollowupCount,
          re_engaged: wasFollowedUp,
          updated_at: new Date().toISOString(),
          ...(username ? { username: String(username) } : {}),
          ...(profile_name ? { profile_name: String(profile_name) } : {})
        }, "bot_id,customer_id"));

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

        if (finalAction === "AUTO_SEND") {
          ctx.waitUntil(sendToMakeScenario2(String(customer_id), dedupedMessages, typingDelays));
          if (batchReviewId) {
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
          messages: [],
          typing_delays_ms: [],
          total_delay_ms: 0,
          message_count: 0,
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
        return new Response(JSON.stringify({ error: "Internal server error", details: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ── /train ────────────────────────────────────────────────────────────────
    if (url.pathname === "/train" && request.method === "POST") {
      try {
        const body = await request.json();
        const { customer_id, review_id, original_reply, corrected_reply, conversation_stage, situation_context, tags } = body;
        if (!original_reply || !corrected_reply) {
          return new Response(JSON.stringify({ error: "Missing original_reply or corrected_reply" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const explainResponse = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            system: `You are an expert sales psychology coach specializing in NEPQ (Neuro-Emotional Persuasion Questioning). Explain the psychological reasoning behind the correction so the AI can learn the pattern. Your explanation should: identify the psychological mistake in the original, explain what the corrected version does better, state the pattern for future situations, be 2-4 sentences, focus on NEPQ principles. Return ONLY valid JSON: { "reason": "your explanation" }`,
            messages: [
              { role: "user", content: `Stage: ${conversation_stage || "Unknown"}\nContext:\n${situation_context || "Not provided"}\nOriginal: "${original_reply}"\nCorrected: "${corrected_reply}"` }
            ],
            temperature: 0.4
          })
        });
        if (!explainResponse.ok) throw new Error(`Claude error: ${await explainResponse.text()}`);
        const explainData = await explainResponse.json();
        const rawText = explainData.content[0].text;
        const cleanText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleanText);

        const learningResp = await fetch(`${SUPABASE_URL}/rest/v1/learnings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            "apikey": env.SUPABASE_SERVICE_KEY,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            bot_id: BOT_ID,
            customer_id: customer_id || null,
            review_id: review_id || null,
            conversation_stage: conversation_stage || null,
            situation_context: situation_context || null,
            original_reply,
            corrected_reply,
            reason: parsed.reason,
            tags: tags || [],
            source: "inbox_edit",
            created_at: new Date().toISOString()
          })
        });
        if (!learningResp.ok) throw new Error(`Supabase error: ${await learningResp.text()}`);

        ctx.waitUntil(sendFeedbackToSlack(env, {
          review_id, customer_id, conversation_stage,
          situation_context, original_reply, edited_reply: corrected_reply,
          reason: parsed.reason, tags: tags || []
        }));

        return new Response(JSON.stringify({ success: true, reason: parsed.reason }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (error) {
        console.error("Train error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ── /explain-learning ─────────────────────────────────────────────────────
    if (url.pathname === "/explain-learning" && request.method === "POST") {
      try {
        const body = await request.json();
        const { original_reply, corrected_reply, conversation_stage, recent_context } = body;
        const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            system: `You are an expert sales psychology coach specializing in NEPQ. Explain the psychological reasoning behind the correction so the AI can learn the pattern. Return ONLY valid JSON: { "reason": "your explanation" }`,
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

    // ── /extract-document ─────────────────────────────────────────────────────
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

    // ── /learnings ────────────────────────────────────────────────────────────
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

    // ── /health ───────────────────────────────────────────────────────────────
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        learning_enabled: true,
        supabase_connected: true,
        documents_enabled: true,
        multi_message: true,
        followup_count_fix: true
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};

export { index_default as default };
//# sourceMappingURL=index.js.map
