// scripts/backfill-embeddings.mjs
// One-time backfill: generates Voyage AI embeddings for all existing learnings
// and bot_documents rows that don't have one yet. Idempotent and safe to re-run.
//
// Usage:
//   $env:VOYAGE_API_KEY = "pa-..."
//   $env:SUPABASE_URL = "https://<project>.supabase.co"
//   $env:SUPABASE_SERVICE_KEY = "eyJ..."
//   $env:BOT_ID = "00000000-0000-0000-0000-000000000002"
//   node scripts/backfill-embeddings.mjs
//
// Runtime: ~30-60 seconds for ~300 rows. Voyage cost: effectively free
// (well inside the 200M token free tier).

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT_ID = process.env.BOT_ID || "00000000-0000-0000-0000-000000000002";

const VOYAGE_MODEL = "voyage-4";
const BATCH_SIZE = 64;

// Verify env vars before doing anything
for (const [k, v] of Object.entries({ VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

console.log("=== Mu AI embedding backfill ===");
console.log(`Supabase: ${SUPABASE_URL}`);
console.log(`Bot ID:   ${BOT_ID}`);
console.log(`Voyage:   ${VOYAGE_MODEL}, batch ${BATCH_SIZE}`);
console.log("");

// ---------- Voyage helper ----------
async function embedBatch(texts, inputType = "document") {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: inputType
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage API ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.data.map(d => d.embedding); // array of 1024-dim arrays, same order as input
}

// ---------- Supabase helpers ----------
async function fetchRows(table, selectCols) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?bot_id=eq.${BOT_ID}&embedding=is.null&select=${selectCols}`;
  const r = await fetch(url, {
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Supabase fetch failed: ${r.status} ${body.slice(0, 300)}`);
  }
  return r.json();
}

async function updateEmbedding(table, id, embedding) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({ embedding })
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Update failed for ${table} id=${id}: ${r.status} ${body.slice(0, 300)}`);
  }
}

// ---------- Text builders ----------
// Learnings: concatenate the three semantically relevant fields. The other
// fields (id, stage, source, etc) aren't useful for similarity matching.
function buildLearningText(row) {
  const parts = [];
  if (row.situation_context) parts.push(`Situation: ${row.situation_context}`);
  if (row.original_reply) parts.push(`Original: ${row.original_reply}`);
  if (row.corrected_reply) parts.push(`Corrected: ${row.corrected_reply}`);
  if (row.reason) parts.push(`Why: ${row.reason}`);
  return parts.join("\n\n") || "(empty learning)";
}

// Documents: name + content. Content can be huge but we truncate to 8000 chars
// (~2000 tokens) since that's what the Worker injects anyway.
function buildDocumentText(row) {
  const name = row.name || "(unnamed)";
  const content = (row.content || "").slice(0, 8000);
  return `${name}\n\n${content}`;
}

// ---------- Main backfill loop ----------
async function backfillTable(table, selectCols, textBuilder) {
  console.log(`\n--- ${table} ---`);
  const rows = await fetchRows(table, selectCols);
  console.log(`  Rows needing embedding: ${rows.length}`);
  if (rows.length === 0) {
    console.log(`  Nothing to do for ${table}.`);
    return { processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(textBuilder);

    process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} rows)...`);
    let embeddings;
    try {
      embeddings = await embedBatch(texts, "document");
    } catch (err) {
      console.log(` Voyage error: ${err.message}`);
      errors += batch.length;
      continue;
    }

    // Write each embedding back. Could parallelize but keeping it serial
    // for simpler debugging.
    for (let j = 0; j < batch.length; j++) {
      try {
        await updateEmbedding(table, batch[j].id, embeddings[j]);
        processed++;
      } catch (err) {
        console.log(`\n  Update error for id=${batch[j].id}: ${err.message}`);
        errors++;
      }
    }

    console.log(` done. Total processed: ${processed}/${rows.length}`);
  }

  return { processed, errors };
}

// ---------- Run ----------
(async () => {
  try {
    const learningResult = await backfillTable(
      "learnings",
      "id,situation_context,original_reply,corrected_reply,reason",
      buildLearningText
    );
    const documentResult = await backfillTable(
      "bot_documents",
      "id,name,content",
      buildDocumentText
    );

    console.log("\n=== Summary ===");
    console.log(`  Learnings:  processed=${learningResult.processed}, errors=${learningResult.errors}`);
    console.log(`  Documents:  processed=${documentResult.processed}, errors=${documentResult.errors}`);
    console.log("");

    if (learningResult.errors > 0 || documentResult.errors > 0) {
      console.log("Some rows failed. Re-run the script to retry just the unembedded rows.");
      process.exit(2);
    }

    console.log("Backfill complete.");
    process.exit(0);
  } catch (err) {
    console.error("\nFATAL:", err.message);
    process.exit(1);
  }
})();