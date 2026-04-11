var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
const BOT_ID = "00000000-0000-0000-0000-000000000002";
const SUPABASE_URL = "https://rydkwsjwlgnivlwlvqku.supabase.co";

// FALLBACK PROMPT - only used if Supabase fails
const FALLBACK_SYSTEM_PROMPT = `You are Coach Shaun responding to golfers via Instagram DMs. You are an expert appointment setter. Your sole responsibility is to determine fit and book Zoom calls. You sort, not sell.`;

// Typing delay calculator - flat 5 second delay per message
function calcTypingDelay(text) {
  const variation = (Math.random() - 0.5) * 1000;
  return Math.round(5000 + variation);
}
__name(calcTypingDelay, "calcTypingDelay");

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
  "conversation_stage": "ENTRY / OPEN LOOP|LOCATION ANCHOR|GOAL LOCK|GOAL DEPTH (MAKE IT SPECIFIC)|WHAT THEY'VE TRIED (PAST + CURRENT)|TRANSLATION / PROGRESS CHECK|BODY LINK ACCEPTANCE + MOBILITY HISTORY|PROGRESS CHECK|PRIORITY GATE|COACHING HAT|CALL BOOK BRIDGE|CALL OFFERED|CALL BOOKING|LONG TERM NURTURE",
  "situation_clarity": 0.0,
  "response_quality": 0.0,
  "confidence": 0.0,
  "messages": ["first message", "second message (optional)", "third message with question (optional)"],
  "reply": "all messages joined into one string — for logging only",
  "lead_readiness": "COLD|WARM|HOT",
  "lead_intent": "LOW|MEDIUM|HIGH",
  "primary_goal": "Distance|Pain/Injuries|Consistency|Unknown",
  "emotional_state": "NEUTRAL|ENGAGED|CONFUSED|SKEPTICAL|DISENGAGING|FRUSTRATED|OBJECTING",
  "next_action": "AUTO_SEND|SEND_TO_INBOX_REVIEW|ESCALATE_TO_HUMAN",
  "escalation_reason": "only fill this if ESCALATE_TO_HUMAN — brief reason why",
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
    "running_summary": "concise summary of conversation so far",
    "objection_count": 0
  }
}

=== CONFIDENCE SCORING — FILL ALL THREE ===
situation_clarity (0.0-1.0): How clearly do you understand the conversation stage and what the lead needs right now?
response_quality (0.0-1.0): How strong is this reply for moving the lead forward — conversion power, emotional tone, and stage alignment?
confidence: Leave as 0.0 — the system calculates this automatically as (situation_clarity x 0.4) + (response_quality x 0.6)

LEAD INTENT CLASSIFICATION (you MUST output one of these per response):
- LOW: Vague, just browsing, avoids answering questions, says maybe later, no pain expressed
- MEDIUM: Has a goal, some engagement, mild frustration but no urgency, still exploring
- HIGH: Clear pain point, time pressure, frustration, uses buyer language, ready to act now

EMOTIONAL STATE CLASSIFICATION:
- NEUTRAL: Normal engaged conversation
- ENGAGED: Enthusiastic, expressive, detailed replies
- CONFUSED: Asking clarifying questions, misunderstanding flow
- SKEPTICAL: Questioning value, doubting, pushing back on premise
- DISENGAGING: Was expressive before, now sending short one-word or one-line replies — lead is losing interest
- FRUSTRATED: Showing irritation, impatience
- OBJECTING: Raising a specific objection to moving forward

ESCALATION RULES — use next_action: ESCALATE_TO_HUMAN when ANY of these apply:
1. Lead explicitly asks to speak to a person or real human — do NOT reveal you are AI, transition gracefully
2. Lead becomes angry or aggressive
3. An action only a human can perform is needed: sending links, forms, payment collection, calendar booking
4. Lead asks a complex, specific, or edge-case question you cannot answer accurately from your campaign knowledge — do NOT make things up
5. Emotional state is CONFUSED or SKEPTICAL and you cannot address it confidently
6. Emotional state is DISENGAGING — lead was previously expressive and has dropped to one-word replies
7. OBJECTION ESCALATION: Check memory.profile_facts.objection_count:
   - If objection_count is 0 (first objection) → set next_action to SEND_TO_INBOX_REVIEW and increment objection_count to 1
   - If objection_count is 1+ (second objection after AI tried) → ESCALATE_TO_HUMAN

REVIEW RULES — use next_action: SEND_TO_INBOX_REVIEW when:
- situation_clarity or response_quality are below 0.75
- lead_intent is LOW
- This is the first objection from the lead (objection_count was 0)
- You are about to repeat a question the lead already answered
- The bot settings say not to auto-send

AUTO-SEND RULES — use next_action: AUTO_SEND only when:
- lead_intent is HIGH AND weighted confidence >= 0.90
- lead_intent is MEDIUM AND weighted confidence >= 0.85 AND stage is early (ENTRY/GOAL LOCK/NURTURE)
- No escalation trigger is present

CRITICAL RULES:
- Reply must sound like Australian coach — short, natural, no corporate language
- Acknowledge then brief bridge then question when appropriate
- NO exclamation points, minimal punctuation
- One main question per message set (in the last message)
- Mirror their message length or go shorter
- NEVER reveal you are an AI
- NEVER make up information you don't have from the campaign knowledge
- SETTER CORRECTIONS at the top of the system prompt OVERRIDE your defaults. Check them FIRST before responding.`;
}, "buildDeveloperPrompt");

// Stages that are safe to auto-send for MEDIUM intent leads
const MEDIUM_INTENT_AUTO_STAGES = [
  "ENTRY / OPEN LOOP",
  "LOCATION ANCHOR",
  "GOAL LOCK",
  "LONG TERM NURTURE"
];

// Profile fact keys mapped to conversation stages
const STAGE_FACT_REQUIREMENTS = {
  "GOAL LOCK":                     "primary_goal",
  "GOAL DEPTH (MAKE IT SPECIFIC)": "primary_goal",
  "WHAT THEY'VE TRIED (PAST + CURRENT)": "what_theyve_tried",
  "TRANSLATION / PROGRESS CHECK":  "current_approach_working",
  "BODY LINK ACCEPTANCE + MOBILITY HISTORY": "what_theyve_tried",
  "PROGRESS CHECK":                "current_approach_working",
  "PRIORITY GATE":                 "priority_level",
  "CALL BOOK BRIDGE":              "primary_goal",
};

function profileFactAlreadyKnown(stage, profileFacts) {
  const requiredFact = STAGE_FACT_REQUIREMENTS[stage];
  if (!requiredFact) return false;
  const value = profileFacts?.[requiredFact];
  return value && value !== "" && value !== "Unknown" && value !== "unknown";
}
__name(profileFactAlreadyKnown, "profileFactAlreadyKnown");

function resolveNextAction(botResponse, autoSendEnabled, profileFacts = {}) {
  // Always honour escalation requests (support both old and new action names)
  if (botResponse.next_action === "ESCALATE_TO_HUMAN") return "ESCALATE_TO_HUMAN";
  if (botResponse.next_action === "HANDOFF_TO_SETTER") return "ESCALATE_TO_HUMAN"; // backward compat

  // Auto-send must be enabled in settings
  if (!autoSendEnabled) return "SEND_TO_INBOX_REVIEW";

  // Calculate weighted confidence from dual scores if available
  const situationClarity = typeof botResponse.situation_clarity === "number" ? botResponse.situation_clarity : (botResponse.confidence || 0);
  const responseQuality = typeof botResponse.response_quality === "number" ? botResponse.response_quality : (botResponse.confidence || 0);
  const weightedConfidence = (situationClarity * 0.4) + (responseQuality * 0.6);

  const stage = botResponse.conversation_stage || "";
  const intent = botResponse.lead_intent || "LOW";

  // LOW intent — always send to review
  if (intent === "LOW") return "SEND_TO_INBOX_REVIEW";

  // Emotional state escalation
  const emotionalState = botResponse.emotional_state || "NEUTRAL";
  if (["DISENGAGING", "CONFUSED", "SKEPTICAL"].includes(emotionalState) && weightedConfidence < 0.85) {
    return "SEND_TO_INBOX_REVIEW";
  }

  // Context check — if the info this message collects is already known, send to review
  if (profileFactAlreadyKnown(stage, profileFacts)) return "SEND_TO_INBOX_REVIEW";

  // HIGH intent — auto-send if weighted confidence is 90%+
  if (intent === "HIGH" && weightedConfidence >= 0.90) return "AUTO_SEND";

  // MEDIUM intent — auto-send only safe early stages at 85%+ weighted confidence
  if (intent === "MEDIUM" && weightedConfidence >= 0.85 && MEDIUM_INTENT_AUTO_STAGES.includes(stage)) return "AUTO_SEND";

  // Everything else — send to review
  return "SEND_TO_INBOX_REVIEW";
}
__name(resolveNextAction, "resolveNextAction");

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
        const { customer_id, message, channel = "instagram", username = null, profile_name = null } = body;
        if (!customer_id || !message) {
          return new Response(JSON.stringify({ error: "Missing customer_id or message" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const [botSettings, memoryData] = await Promise.all([
          getBotSettings(env),
          env.MEMORY_STORE.get(`memory:${customer_id}`, { type: "json" })
        ]);

        const autoSendEnabled = botSettings.auto_send_enabled === true;
        const systemPrompt = botSettings.system_prompt || FALLBACK_SYSTEM_PROMPT;
        const botModel = botSettings.model || 'gpt-5.4-mini';
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
          avatar: botSettings.target_avatar || ''
        };

        const memory = memoryData || { messages: [], running_summary: "", profile_facts: {} };

        const isTesterInit = message === "__tester_init__";
        if (!isTesterInit) {
          memory.messages.push({ role: "user", content: message, timestamp: Date.now() });
          if (memory.messages.length > 15) memory.messages = memory.messages.slice(-15);
        }

        const [learnings, documents] = await Promise.all([
          fetchRelevantLearnings(env, memory),
          fetchActiveDocuments(env)
        ]);

        const botResponse = await callOpenAI(env, memory, learnings, documents, systemPrompt, botModel, intentDefs, campaignConfig);
        if (!botResponse || (!botResponse.reply && !botResponse.messages)) throw new Error("Invalid bot response structure");

        const rawMessages = Array.isArray(botResponse.messages) && botResponse.messages.length > 0
          ? botResponse.messages
          : [botResponse.reply];

        const dedupedMessages = rawMessages.filter((msg, idx, arr) =>
          arr.findIndex(m => m.trim().toLowerCase() === msg.trim().toLowerCase()) === idx
        );

        const typingDelays = dedupedMessages.map(msg => calcTypingDelay(msg));
        const totalDelay = typingDelays.reduce((a, b) => a + b, 0);
        const joinedReply = dedupedMessages.join(" ");

        const review_id = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const finalAction = resolveNextAction(botResponse, autoSendEnabled, memory.profile_facts);

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
          // Track objection count for escalation logic
          if (typeof botResponse.memory_update.objection_count === "number") {
            memory.profile_facts.objection_count = botResponse.memory_update.objection_count;
          }
        }

        await env.MEMORY_STORE.put(`memory:${customer_id}`, JSON.stringify(memory));

        ctx.waitUntil(supabaseUpsert(env, "conversations", {
          bot_id: BOT_ID,
          customer_id: String(customer_id),
          channel,
          status: botResponse.conversation_stage === "CALL BOOKING" ? "booked" : "active",
          lead_readiness: botResponse.lead_readiness || "COLD",
          lead_intent: botResponse.lead_intent || "LOW",
          primary_goal: botResponse.primary_goal || null,
          conversation_stage: botResponse.conversation_stage || null,
          messages: memory.messages,
          profile_facts: memory.profile_facts,
          running_summary: memory.running_summary,
          updated_at: new Date().toISOString(),
          ...(username ? { username: String(username) } : {}),
          ...(profile_name ? { profile_name: String(profile_name) } : {})
        }, "bot_id,customer_id"));

        if (finalAction === "SEND_TO_INBOX_REVIEW" || finalAction === "ESCALATE_TO_HUMAN") {
          ctx.waitUntil(supabaseInsert(env, "reviews", {
            id: review_id, bot_id: BOT_ID,
            customer_id: String(customer_id),
            action_type: finalAction,
            conversation_stage: botResponse.conversation_stage || null,
            confidence: botResponse.confidence || null,
            situation_clarity: botResponse.situation_clarity || null,
            response_quality: botResponse.response_quality || null,
            emotional_state: botResponse.emotional_state || null,
            escalation_reason: botResponse.escalation_reason || null,
            bot_reply: joinedReply,
            bot_messages: dedupedMessages,
            typing_delays: typingDelays,
            internal_notes: botResponse.internal_notes || null,
            last_messages: memory.messages.slice(-5),
            status: "pending",
            created_at: new Date().toISOString(),
            ...(username ? { username: String(username) } : {}),
            ...(profile_name ? { profile_name: String(profile_name) } : {})
          }));
        }

        return new Response(JSON.stringify({
          review_id,
          customer_id,
          user_message: message,
          messages: dedupedMessages,
          typing_delays_ms: typingDelays,
          total_delay_ms: totalDelay,
          message_count: dedupedMessages.length,
          bot_reply: joinedReply,
          conversation_stage: botResponse.conversation_stage,
          confidence: botResponse.confidence,
          situation_clarity: botResponse.situation_clarity,
          response_quality: botResponse.response_quality,
          emotional_state: botResponse.emotional_state,
          lead_readiness: botResponse.lead_readiness,
          lead_intent: botResponse.lead_intent || "LOW",
          next_action: finalAction,
          escalation_reason: botResponse.escalation_reason || null,
          auto_send_enabled: autoSendEnabled,
          progression_goal: botResponse.progression_goal || null,
          tags: botResponse.tags || [],
          recent_conversation: memory.messages.slice(-5).map(m => ({
            role: m.role === "user" ? "Lead" : "Bot",
            content: m.content,
            timestamp: new Date(m.timestamp).toLocaleString()
          })),
          timestamp: new Date().toLocaleString()
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      } catch (error) {
        console.error("Webhook error:", error);
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
        const botModel = 'gpt-5.4-mini';
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: botModel,
            messages: [
              { role: "system", content: `You are a prompt engineering assistant for an AI appointment setter bot. The user will give you a plain English instruction to update the bot's system prompt. Your job: 1. Identify exactly which section(s) of the prompt need to change 2. Make ONLY the requested change 3. Preserve all existing structure, formatting, and sections 4. If the instruction is vague, ask for clarification. Return ONLY valid JSON: { "updated_prompt": "full updated prompt", "explanation": "what changed and why", "changes": ["change 1"], "needs_clarification": false }. If clarification needed: { "needs_clarification": true, "question": "your question" }` },
              { role: "user", content: `Current system prompt:\n\n${current_prompt}\n\n---\n\nInstruction: ${instruction}` }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
          })
        });
        if (!response.ok) throw new Error(`OpenAI error: ${await response.text()}`);
        const data = await response.json();
        const parsed = JSON.parse(data.choices[0].message.content);
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
        const botModel = 'gpt-5.4-mini';
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: botModel,
            messages: [
              { role: "system", content: `You are a sales psychology expert analysing corrections made to an AI appointment setter for a golf fitness coaching business. Explain the psychological reasoning behind the correction so the AI can learn the pattern. Your explanation should: identify the psychological mistake in the original, explain what the corrected version does better, state the pattern for future situations, be 2-4 sentences, focus on conversion psychology principles. Return ONLY valid JSON: { "explanation": "your psychological explanation", "pattern": "the reusable pattern learned", "tags": ["tag1", "tag2"] }` },
              { role: "user", content: `Stage: ${conversation_stage || "Unknown"}\n\nContext: ${recent_context || "Not provided"}\n\nOriginal reply: "${original_reply}"\n\nCorrected reply: "${corrected_reply}"` }
            ],
            temperature: 0.4,
            response_format: { type: "json_object" }
          })
        });
        if (!response.ok) throw new Error(`OpenAI error: ${await response.text()}`);
        const data = await response.json();
        const parsed = JSON.parse(data.choices[0].message.content);
        return new Response(JSON.stringify(parsed), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
        console.error("Explain error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // /approve
    if (url.pathname === "/approve" && request.method === "POST") {
      try {
        const body = await request.json();
        const { review_id, customer_id, final_reply } = body;
        if (!review_id || !customer_id) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        await fetch(`${SUPABASE_URL}/rest/v1/reviews?id=eq.${review_id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            "apikey": env.SUPABASE_SERVICE_KEY,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ status: "approved", final_reply: final_reply || "", resolved_at: new Date().toISOString() })
        });
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
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

async function supabaseInsert(env, table, data) {
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
  if (!response.ok) console.error(`Supabase insert error on ${table}:`, await response.text());
}
__name(supabaseInsert, "supabaseInsert");

async function supabaseUpsert(env, table, data, onConflict) {
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
  if (!response.ok) console.error(`Supabase upsert error on ${table}:`, await response.text());
}
__name(supabaseUpsert, "supabaseUpsert");

async function getBotSettings(env) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/bots?id=eq.${BOT_ID}&select=auto_send_enabled,system_prompt,model,intent_definitions,lead_type,buyer_type,communication_style,campaign_goal,target_avatar`,
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

async function callOpenAI(env, memory, learnings = [], documents = [], systemPrompt, model = 'gpt-5.4-mini', intentDefs = {}, campaignConfig = {}) {
  const lastMessages = (memory.messages || []).slice(-10);

  const learningsSection = learnings && learnings.length > 0 ? `
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
\uD83D\uDEA8 SETTER CORRECTIONS - HIGHEST PRIORITY \uD83D\uDEA8
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

CRITICAL: These are REAL corrections made by human setters who reviewed your previous responses.
Before writing ANY reply, check if this situation matches ANY of these corrections.
If it does, APPLY THE PATTERN the setter taught you.

Setter corrections OVERRIDE all default behaviors below.

${learnings.map((l, i) => `
CORRECTION ${i + 1} | Stage: ${l.conversation_stage || "General"}
Situation: ${l.situation_context || "General conversation"}
\u274C WRONG: "${l.original_reply}"
\u2705 RIGHT: "${l.edited_reply}"
\uD83E\uDDE0 WHY: ${l.reason}
Tags: ${l.tags && l.tags.length > 0 ? l.tags.join(", ") : "None"}
---`).join("\n")}

PATTERNS TO LOOK FOR:
- If setter shortened reply \u2192 you were too long
- If setter added empathy \u2192 you were too clinical
- If setter removed question \u2192 you were moving too fast
- If setter changed question style \u2192 yours was too robotic or salesy
- If setter split into multiple messages \u2192 do the same in similar situations

These corrections define what good looks like. They are LAW.
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

` : "";

  const documentSection = documents.length > 0
    ? `\n\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
KNOWLEDGE BASE DOCUMENTS - USE AS REFERENCE
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

The following documents contain information about the coaching program. Reference them when relevant.
Do NOT quote verbatim. Use natural language.

${documents.map((d, i) => `DOCUMENT ${i + 1}: ${d.name}\n${(d.content || "").slice(0, 2000)}${(d.content || "").length > 2000 ? "\n[...truncated]" : ""}`).join("\n\n---\n\n")}

\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\n`
    : "";

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

  const avatarLine = campaignConfig.avatar ? 'Target Avatar: ' + campaignConfig.avatar : '';
  const hasCustomCampaignConfig = campaignConfig.avatar && campaignConfig.avatar.length > 5;
  const campaignSection = hasCustomCampaignConfig
    ? '\n=== CAMPAIGN CONFIGURATION ===\n'
    + 'Lead Type: ' + (campaignConfig.leadType || 'Cold') + '\n'
    + 'Buyer Type: ' + (campaignConfig.buyerType || 'Emotional') + ' - ' + buyerDesc + '\n'
    + 'Communication Style: ' + (campaignConfig.commStyle || 'Hybrid') + ' - ' + styleDesc + '\n'
    + 'Campaign Goal: ' + (campaignConfig.goal || 'General') + '\n'
    + (avatarLine ? avatarLine + '\n' : '')
    + '=== END CAMPAIGN CONFIG ===\n\n'
    : '';

  const finalSystemPrompt = learningsSection + documentSection + campaignSection + systemPrompt;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: buildDeveloperPrompt(memory, lastMessages) }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }
  const data = await response.json();
  const content = data.choices[0].message.content;
  let parsed;
  try { parsed = JSON.parse(content); }
  catch (e) { throw new Error(`Failed to parse OpenAI response as JSON: ${content}`); }

  if (!parsed.messages && !parsed.reply) {
    throw new Error("OpenAI response missing required fields");
  }
  if (!parsed.conversation_stage || !parsed.next_action) {
    throw new Error("OpenAI response missing conversation_stage or next_action");
  }

  // Normalise messages/reply
  if (!parsed.messages) parsed.messages = [parsed.reply];
  if (!parsed.reply) parsed.reply = parsed.messages.join(" ");

  // Calculate weighted confidence from dual scores
  const situationClarity = typeof parsed.situation_clarity === "number" ? parsed.situation_clarity : (parsed.confidence || 0);
  const responseQuality = typeof parsed.response_quality === "number" ? parsed.response_quality : (parsed.confidence || 0);
  parsed.situation_clarity = situationClarity;
  parsed.response_quality = responseQuality;
  parsed.confidence = Math.round(((situationClarity * 0.4) + (responseQuality * 0.6)) * 100) / 100;

  // Normalize old action names for backward compat
  if (parsed.next_action === "HANDOFF_TO_SETTER") parsed.next_action = "ESCALATE_TO_HUMAN";
  if (parsed.next_action === "SEND_TO_SLACK_REVIEW") parsed.next_action = "SEND_TO_INBOX_REVIEW";

  // Increment usage_count on documents (fire and forget)
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
__name(callOpenAI, "callOpenAI");

export { index_default as default };