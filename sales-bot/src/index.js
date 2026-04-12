var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
const BOT_ID = "00000000-0000-0000-0000-000000000002";
const SUPABASE_URL = "https://rydkwsjwlgnivlwlvqku.supabase.co";

// FALLBACK PROMPT - only used if Supabase fails
const FALLBACK_SYSTEM_PROMPT = `You are Coach Shaun responding to golfers via Instagram DMs. You are an expert appointment setter. Your sole responsibility is to determine fit and book Zoom calls. You sort, not sell.`;

// Typing delay calculator
// Flat 5 second delay per message — natural but not too slow
function calcTypingDelay(text) {
  const variation = (Math.random() - 0.5) * 1000;      // ±0.5s natural variation
  return Math.round(5000 + variation);                  // ~5s per message
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
  "confidence": 0.0-1.0,
  "messages": ["first message", "second message (optional)", "third message with question (optional)"],
  "reply": "all messages joined into one string — for logging only",
  "lead_readiness": "COLD|WARM|HOT",
  "lead_intent": "LOW|MEDIUM|HIGH",
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
- If lead_intent is MEDIUM and situation_clarity >= 0.80 and response_quality >= 0.85 and stage is early (ENTRY/GOAL LOCK/NURTURE), set next_action to AUTO_SEND
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
    }
  } catch (error) {
    console.error(`Supabase insert exception (${table}):`, error);
  }
}
__name(supabaseInsert, "supabaseInsert");

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
  "ENTRY / OPEN LOOP",
  "LOCATION ANCHOR",
  "GOAL LOCK",
  "LONG TERM NURTURE"
];

// Profile fact keys mapped to conversation stages
// If the fact is already known, skip auto-sending that stage
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
          avatar: botSettings.target_avatar || '',
          aiBehavior: botSettings.ai_behavior_settings || {}
        };

        const memory = memoryData || { messages: [], running_summary: "", profile_facts: {} };

        // Handle tester init — don't add the trigger to memory, just get opening message
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

        // ── Multi-message normalisation ────────────────────────────────────
        // Use messages array if provided, otherwise fall back to single reply
        const rawMessages = Array.isArray(botResponse.messages) && botResponse.messages.length > 0
          ? botResponse.messages
          : [botResponse.reply];

        // Deduplicate — safety net for the glitch where bot repeats itself
        const dedupedMessages = rawMessages.filter((msg, idx, arr) =>
          arr.findIndex(m => m.trim().toLowerCase() === msg.trim().toLowerCase()) === idx
        );

        // Calculate typing delay per message
        const typingDelays = dedupedMessages.map(msg => calcTypingDelay(msg));
        const totalDelay = typingDelays.reduce((a, b) => a + b, 0);

        // Primary reply = all messages joined (for memory + logging)
        const joinedReply = dedupedMessages.join(" ");

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
          await sendToSlack(env, {
            customer_id, action: finalAction,
            conversation_stage: botResponse.conversation_stage,
            confidence: botResponse.confidence,
            last_messages: memory.messages.slice(-5),
            bot_messages: dedupedMessages,
            typing_delays: typingDelays,
            bot_reply: joinedReply,
            internal_notes: botResponse.internal_notes,
            review_id, auto_send_enabled: autoSendEnabled
          });

          ctx.waitUntil(supabaseInsert(env, "reviews", {
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
          }));
        }

        return new Response(JSON.stringify({
          review_id,
          customer_id,
          user_message: message,

          // Multi-message fields — use these in Make/Zapier
          messages: dedupedMessages,
          typing_delays_ms: typingDelays,
          total_delay_ms: totalDelay,
          message_count: dedupedMessages.length,

          // Full response for Tester and integrations
          bot_reply: joinedReply,

          conversation_stage: botResponse.conversation_stage,
          decision_type: botResponse.decision_type || null,
          confidence: botResponse.confidence,
          lead_readiness: botResponse.lead_readiness,
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
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: "gpt-5.4",
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
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: "gpt-5.4",
            messages: [
              { role: "system", content: `You are a sales psychology expert analysing corrections made to an AI appointment setter for a golf fitness coaching business. Explain the psychological reasoning behind the correction so the AI can learn the pattern. Your explanation should: identify the psychological mistake in the original, explain what the corrected version does better, state the pattern for future situations, be 2-4 sentences, focus on NEPQ principles. Return ONLY valid JSON: { "reason": "your explanation" }` },
              { role: "user", content: `Stage: ${conversation_stage || "Unknown"}\nContext:\n${recent_context || "Not provided"}\nOriginal: "${original_reply}"\nCorrected: "${corrected_reply}"` }
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

async function callOpenAI(env, memory, learnings = [], documents = [], systemPrompt, model = 'gpt-5.4-mini', intentDefs = {}, campaignConfig = {}) {
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

  // Support both old (reply only) and new (messages array) response formats
  if (!parsed.messages && !parsed.reply) {
    throw new Error("OpenAI response missing required fields");
  }
  if (!parsed.conversation_stage || !parsed.next_action) {
    throw new Error("OpenAI response missing conversation_stage or next_action");
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
__name(callOpenAI, "callOpenAI");

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