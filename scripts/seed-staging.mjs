// scripts/seed-staging.mjs
// One-shot: copies a sample of production learnings (and the 3 documents) into
// staging, with embeddings generated for each. Used once to populate staging
// with realistic data so the semantic match function can be tested.
//
// Usage:
//   $env:VOYAGE_API_KEY = "..."
//   $env:PROD_SUPABASE_URL = "https://rydkwsjwlgnivlwlvqku.supabase.co"
//   $env:PROD_SUPABASE_SERVICE_KEY = "..."
//   $env:STAGING_SUPABASE_URL = "https://hlpucysbaqerhwahfolg.supabase.co"
//   $env:STAGING_SUPABASE_SERVICE_KEY = "..."
//   $env:LEARNING_SAMPLE_SIZE = "20"   # optional, default 20
//   node scripts/seed-staging.mjs

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const PROD_URL = process.env.PROD_SUPABASE_URL;
const PROD_KEY = process.env.PROD_SUPABASE_SERVICE_KEY;
const STAGING_URL = process.env.STAGING_SUPABASE_URL;
const STAGING_KEY = process.env.STAGING_SUPABASE_SERVICE_KEY;
const BOT_ID = process.env.BOT_ID || "00000000-0000-0000-0000-000000000002";
const LEARNING_SAMPLE_SIZE = parseInt(process.env.LEARNING_SAMPLE_SIZE || "20", 10);

for (const [k, v] of Object.entries({
  VOYAGE_API_KEY, PROD_URL, PROD_KEY, STAGING_URL, STAGING_KEY
})) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

console.log("=== Staging seed from production ===");
console.log(`Sample size: ${LEARNING_SAMPLE_SIZE} learnings + all active documents`);
console.log("");

async function fetchProd(table, query) {
  const url = `${PROD_URL}/rest/v1/${table}?${query}`;
  const r = await fetch(url, {
    headers: { "apikey": PROD_KEY, "Authorization": `Bearer ${PROD_KEY}` }
  });
  if (!r.ok) throw new Error(`Prod fetch ${table} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function insertStaging(table, rows) {
  const url = `${STAGING_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": STAGING_KEY,
      "Authorization": `Bearer ${STAGING_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error(`Staging insert ${table} ${r.status}: ${await r.text()}`);
}

async function embedBatch(texts) {
  const r = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input: texts, model: "voyage-4", input_type: "document" })
  });
  if (!r.ok) throw new Error(`Voyage ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.data.map(d => d.embedding);
}

function buildLearningText(row) {
  const parts = [];
  if (row.situation_context) parts.push(`Situation: ${row.situation_context}`);
  if (row.original_reply) parts.push(`Original: ${row.original_reply}`);
  if (row.corrected_reply) parts.push(`Corrected: ${row.corrected_reply}`);
  if (row.reason) parts.push(`Why: ${row.reason}`);
  return parts.join("\n\n") || "(empty learning)";
}

function buildDocumentText(row) {
  return `${row.name || "(unnamed)"}\n\n${(row.content || "").slice(0, 8000)}`;
}

(async () => {
  // ---- Step 1: fetch a sample from production ----
  console.log("[1/4] Fetching learnings from production...");
  // PostgREST doesn't have a clean RANDOM(); use a generous LIMIT then shuffle in JS.
  // We grab the 100 most recent then sample randomly from those, which biases
  // toward fresh content (preferable for testing modern bot behavior).
  const prodLearnings = await fetchProd(
    "learnings",
    `bot_id=eq.${BOT_ID}&order=created_at.desc&limit=100&select=*`
  );
  console.log(`  Pulled ${prodLearnings.length} candidate learnings.`);

  // Random sample without replacement
  const shuffled = [...prodLearnings].sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, LEARNING_SAMPLE_SIZE);
  console.log(`  Sampled ${sampled.length} for staging.`);

  console.log("[2/4] Fetching documents from production...");
  const prodDocs = await fetchProd(
    "bot_documents",
    `bot_id=eq.${BOT_ID}&status=eq.active&select=*`
  );
  console.log(`  Pulled ${prodDocs.length} active documents.`);

  // ---- Step 2: embed everything ----
  console.log("[3/4] Generating embeddings via Voyage...");

  const learningTexts = sampled.map(buildLearningText);
  const learningEmbeddings = await embedBatch(learningTexts);
  console.log(`  Embedded ${learningEmbeddings.length} learnings.`);

  const docTexts = prodDocs.map(buildDocumentText);
  const docEmbeddings = prodDocs.length > 0 ? await embedBatch(docTexts) : [];
  console.log(`  Embedded ${docEmbeddings.length} documents.`);

  // ---- Step 3: insert into staging with embeddings ----
  console.log("[4/4] Inserting into staging...");

  // Drop the original id so staging generates fresh ones; keep all other fields.
  // Also drop embedding column to ensure we set the freshly generated one.
  const learningRows = sampled.map((r, i) => {
    const { id, embedding, ...rest } = r;
    return { ...rest, embedding: learningEmbeddings[i] };
  });
  if (learningRows.length > 0) {
    await insertStaging("learnings", learningRows);
    console.log(`  Inserted ${learningRows.length} learnings into staging.`);
  }

  const docRows = prodDocs.map((r, i) => {
    const { id, embedding, ...rest } = r;
    return { ...rest, embedding: docEmbeddings[i] };
  });
  if (docRows.length > 0) {
    await insertStaging("bot_documents", docRows);
    console.log(`  Inserted ${docRows.length} documents into staging.`);
  }

  console.log("");
  console.log("Staging seed complete.");
})().catch(err => {
  console.error("");
  console.error("FATAL:", err.message);
  process.exit(1);
});