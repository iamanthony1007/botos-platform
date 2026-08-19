// sales-bot/test-connection-status.mjs
// Local matrix for GET /meta/connection-status.  Run from sales-bot/: node test-connection-status.mjs
//
// Drives the SHIPPED handler: imports sales-bot/src/index.js and calls its
// default.fetch, so this exercises the real route table, the real CORS headers
// and the real verifyDashboardJwt, not a copy. Supabase (both /auth/v1/user and
// /rest/v1/connected_accounts) is a local mock server, so nothing touches a real
// project and no credits are spent.
//
// The load-bearing assertions are the last two: NO response body under ANY
// branch may contain token material, and the outgoing PostgREST query must never
// name a token column, even when the mock tries to hand one back.

import http from "node:http";

const MOCK_PORT = 8799;
const SENTINEL_TOKEN = "IGQVJTOKENSENTINELdoNOTleakME";
const SENTINEL_ACCOUNT_ID = "17841400000000001";
const VALID_JWT = "valid.jwt.token";
const BOT = "00000000-0000-0000-0000-000000000002";

// ---------------------------------------------------------------- mock supabase
let scenario = "none";
const seen = { authCalls: 0, restCalls: 0, restUrls: [] };

const mock = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);

  if (u.pathname === "/auth/v1/user") {
    seen.authCalls++;
    const auth = req.headers["authorization"] || "";
    if (auth === "Bearer " + VALID_JWT) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: "11111111-2222-3333-4444-555555555555" }));
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "invalid jwt" }));
  }

  if (u.pathname === "/rest/v1/connected_accounts") {
    seen.restCalls++;
    seen.restUrls.push(req.url);
    if (scenario === "rest_500") {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "boom" }));
    }
    if (scenario === "none" || scenario === "deauthorized_only") {
      // deauthorized_only relies on the Worker sending deauthorized=eq.false,
      // which PostgREST would filter server-side. Asserted separately below.
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([]));
    }
    if (scenario === "connected") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([{
        account_username: "demo_handle",
        created_at: "2026-08-10T09:15:00.000Z"
      }]));
    }
    if (scenario === "hostile_row") {
      // The mock DELIBERATELY ignores the select and returns token material.
      // If the handler ever spreads the row instead of naming three fields,
      // this is the case that catches it.
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([{
        account_username: "demo_handle",
        created_at: "2026-08-10T09:15:00.000Z",
        access_token_encrypted: SENTINEL_TOKEN,
        external_account_id: SENTINEL_ACCOUNT_ID,
        token_expires_at: "2026-10-09T09:15:00.000Z"
      }]));
    }
    if (scenario === "null_username") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([{ account_username: null, created_at: null }]));
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "mock: unrouted " + u.pathname }));
});

await new Promise(r => mock.listen(MOCK_PORT, "127.0.0.1", r));

// ---------------------------------------------------------------- worker harness
const worker = (await import(new URL("./src/index.js", import.meta.url))).default;

const env = {
  SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  SUPABASE_SERVICE_KEY: "test-service-key",
  SUPABASE_ANON_KEY: "test-anon-key",
  ENVIRONMENT: "test",
  MEMORY_STORE: {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [] })
  }
};
const ctx = { waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); }, passThroughOnException: () => {} };

async function call(path, { method = "GET", headers = {} } = {}) {
  const req = new Request("https://sales-bot.test" + path, { method, headers });
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json body, keep text */ }
  return { status: res.status, text, json, headers: res.headers };
}

// ---------------------------------------------------------------- assertions
let pass = 0, fail = 0;
const allBodies = [];
function t(label, ok, detail) {
  if (ok) { pass++; console.log("PASS  " + label + (detail ? "  " + detail : "")); }
  else { fail++; console.log("FAIL  " + label + (detail ? "  " + detail : "")); }
}
function reset(s) { scenario = s; seen.authCalls = 0; seen.restCalls = 0; seen.restUrls = []; }

const AUTH = { Authorization: "Bearer " + VALID_JWT };
const P = "/meta/connection-status";

console.log("=== GET /meta/connection-status local matrix ===\n");

// 1. no Authorization header at all
reset("connected");
let r = await call(`${P}?bot_id=${BOT}`);
allBodies.push(r.text);
t("1  no Authorization header -> 401, DB never read",
  r.status === 401 && r.json?.error === "unauthorized" && seen.restCalls === 0,
  `http=${r.status} restCalls=${seen.restCalls}`);

// 2. malformed Authorization scheme
reset("connected");
r = await call(`${P}?bot_id=${BOT}`, { headers: { Authorization: "Basic abc123" } });
allBodies.push(r.text);
t("2  non-Bearer Authorization -> 401, auth endpoint never even called",
  r.status === 401 && seen.restCalls === 0 && seen.authCalls === 0,
  `http=${r.status} authCalls=${seen.authCalls} restCalls=${seen.restCalls}`);

// 3. bearer token Supabase rejects
reset("connected");
r = await call(`${P}?bot_id=${BOT}`, { headers: { Authorization: "Bearer wrong.jwt.here" } });
allBodies.push(r.text);
t("3  invalid JWT -> 401, DB never read",
  r.status === 401 && seen.authCalls === 1 && seen.restCalls === 0,
  `http=${r.status} authCalls=${seen.authCalls} restCalls=${seen.restCalls}`);

// 4. authed but no bot_id
reset("connected");
r = await call(P, { headers: AUTH });
allBodies.push(r.text);
t("4  missing bot_id -> 400, DB never read",
  r.status === 400 && seen.restCalls === 0,
  `http=${r.status} err=${JSON.stringify(r.json?.error)}`);

// 5. authed but bot_id is not a uuid (injection-shaped)
reset("connected");
r = await call(`${P}?bot_id=${encodeURIComponent("*&select=access_token_encrypted")}`, { headers: AUTH });
allBodies.push(r.text);
t("5  malformed bot_id -> 400, DB never read (no PostgREST injection surface)",
  r.status === 400 && seen.restCalls === 0,
  `http=${r.status} restCalls=${seen.restCalls}`);

// 6. authed, valid bot, nothing connected
reset("none");
r = await call(`${P}?bot_id=${BOT}`, { headers: AUTH });
allBodies.push(r.text);
t("6  no connection -> 200 connected:false, nulls, exactly 3 keys",
  r.status === 200 && r.json?.connected === false && r.json?.username === null &&
  r.json?.connected_at === null && Object.keys(r.json).length === 3,
  `http=${r.status} body=${r.text}`);

// 7. authed, valid bot, connected
reset("connected");
r = await call(`${P}?bot_id=${BOT}`, { headers: AUTH });
allBodies.push(r.text);
t("7  connected -> 200 connected:true with handle and connected_at",
  r.status === 200 && r.json?.connected === true && r.json?.username === "demo_handle" &&
  r.json?.connected_at === "2026-08-10T09:15:00.000Z" && Object.keys(r.json).length === 3,
  `http=${r.status} body=${r.text}`);

// 8. the query itself: right filters, and NO token column named
t("8  PostgREST query filters on platform + bot_id + deauthorized=false, newest first",
  seen.restUrls.length === 1 &&
  seen.restUrls[0].includes("platform=eq.instagram_api") &&
  seen.restUrls[0].includes(`bot_id=eq.${BOT}`) &&
  seen.restUrls[0].includes("deauthorized=eq.false") &&
  seen.restUrls[0].includes("order=created_at.desc") &&
  seen.restUrls[0].includes("limit=1"),
  seen.restUrls[0] || "(no query captured)");

t("9  select names ONLY account_username and created_at, never a token column",
  seen.restUrls[0].includes("select=account_username,created_at") &&
  !seen.restUrls[0].includes("access_token") &&
  !seen.restUrls[0].includes("external_account_id"),
  "select clause verified verbatim");

// 10. deauthorized-only bot reads as not connected
reset("deauthorized_only");
r = await call(`${P}?bot_id=${BOT}`, { headers: AUTH });
allBodies.push(r.text);
t("10 deauthorized row only -> 200 connected:false (filter carried in the query)",
  r.status === 200 && r.json?.connected === false &&
  seen.restUrls[0].includes("deauthorized=eq.false"),
  `http=${r.status} body=${r.text}`);

// 11. HOSTILE row: mock returns token material anyway
reset("hostile_row");
r = await call(`${P}?bot_id=${BOT}`, { headers: AUTH });
allBodies.push(r.text);
t("11 hostile row carrying a token -> response still 3 keys, token absent",
  r.status === 200 && Object.keys(r.json).length === 3 &&
  !r.text.includes(SENTINEL_TOKEN) && !r.text.includes(SENTINEL_ACCOUNT_ID) &&
  !("access_token_encrypted" in r.json) && !("external_account_id" in r.json),
  `http=${r.status} body=${r.text}`);

// 12. row with null username / null created_at
reset("null_username");
r = await call(`${P}?bot_id=${BOT}`, { headers: AUTH });
allBodies.push(r.text);
t("12 connected row with null handle -> connected:true, username null, no crash",
  r.status === 200 && r.json?.connected === true && r.json?.username === null &&
  r.json?.connected_at === null,
  `http=${r.status} body=${r.text}`);

// 13. Supabase lookup failure
reset("rest_500");
r = await call(`${P}?bot_id=${BOT}`, { headers: AUTH });
allBodies.push(r.text);
t("13 Supabase 500 -> 502 with a generic error, no row data, no token",
  r.status === 502 && r.json?.error === "lookup failed" && !r.text.includes(SENTINEL_TOKEN),
  `http=${r.status} body=${r.text}`);

// 14. wrong method falls through (route is GET-gated)
reset("connected");
r = await call(`${P}?bot_id=${BOT}`, { method: "POST", headers: AUTH });
allBodies.push(r.text);
t("14 POST to the route -> not handled here (404), DB never read",
  r.status === 404 && seen.restCalls === 0,
  `http=${r.status}`);

// 15. CORS preflight allows Authorization (the 2026-08-17 incident class)
reset("connected");
r = await call(`${P}?bot_id=${BOT}`, { method: "OPTIONS" });
const acah = r.headers.get("Access-Control-Allow-Headers") || "";
const acam = r.headers.get("Access-Control-Allow-Methods") || "";
t("15 OPTIONS preflight allows Authorization and GET",
  acah.toLowerCase().includes("authorization") && acam.includes("GET"),
  `allow-headers="${acah}" allow-methods="${acam}"`);

// 16. CORS headers present on the real responses too
reset("connected");
r = await call(`${P}?bot_id=${BOT}`, { headers: AUTH });
t("16 200 response carries CORS origin header",
  r.headers.get("Access-Control-Allow-Origin") === "*",
  `origin="${r.headers.get("Access-Control-Allow-Origin")}"`);

// 17. regression: /meta/send is still auth-gated and still routed
reset("connected");
r = await call("/meta/send", { method: "POST" });
allBodies.push(r.text);
t("17 regression: POST /meta/send unauthenticated still 401",
  r.status === 401 && r.json?.error === "unauthorized",
  `http=${r.status}`);

// 18. global: nothing anywhere leaked the sentinels
const leaked = allBodies.filter(b => b.includes(SENTINEL_TOKEN) || b.includes(SENTINEL_ACCOUNT_ID));
t("18 GLOBAL: no response body across all cases contains token or account id",
  leaked.length === 0,
  `${allBodies.length} bodies scanned, ${leaked.length} leaks`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await new Promise(r => mock.close(r));
process.exitCode = fail === 0 ? 0 : 1;
