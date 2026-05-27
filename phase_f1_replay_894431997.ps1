# phase_f1_replay_894431997.ps1
# Replays the EXACT production failure case for customer 894431997 (nikutarashii)
# against the STAGING Worker, to verify the max_tokens=2048 + parse-failure safety
# net fix (branch fix/parse-failure-and-max-tokens). STAGING ONLY.
#
# Flow: seed one conversations row (copy of production history) via Supabase REST,
# then POST the exact failing message to the staging Worker webhook and evaluate.
#
# Em-dash note: the production payload contains em dashes (U+2014) in
# running_summary and profile_facts. To reproduce the failing payload faithfully
# WITHOUT writing any non-ASCII byte into this file (raw em dashes previously got
# mojibake-corrupted on save), the em dash is injected at runtime via [char]0x2014.
# Windows PowerShell ConvertTo-Json serialises it as a unicode escape, so Supabase stores the
# real character while this file stays pure ASCII.
#
# Auth: reads anon key from dashboard/.env.staging by default. To escalate to
# service role, set $env:SUPABASE_STAGING_SERVICE_KEY before running.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$WORKER   = "https://sales-bot-staging.nellakuate.workers.dev/webhook"
$BOT_ID   = "00000000-0000-0000-0000-000000000002"
$EM       = [char]0x2014   # em dash, injected at runtime to keep this file ASCII

$ts          = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$CUSTOMER_ID = "tester_replay_894431997_$ts"
$USERNAME    = "nikutarashii_test"

function Get-StagingConfig {
  $envPath = Join-Path $PSScriptRoot 'dashboard\.env.staging'
  if (-not (Test-Path $envPath)) { throw "Cannot find $envPath. Run this from the repo root." }
  $url = $null; $anon = $null
  foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*VITE_SUPABASE_URL\s*=\s*(.+?)\s*$')      { $url  = $matches[1].Trim() }
    if ($line -match '^\s*VITE_SUPABASE_ANON_KEY\s*=\s*(.+?)\s*$') { $anon = $matches[1].Trim() }
  }
  if (-not $url) { throw "VITE_SUPABASE_URL not found in .env.staging" }
  if ($env:SUPABASE_STAGING_SERVICE_KEY) {
    return @{ url=$url; key=$env:SUPABASE_STAGING_SERVICE_KEY; role='service_role' }
  }
  if (-not $anon) { throw "VITE_SUPABASE_ANON_KEY not found in .env.staging" }
  return @{ url=$url; key=$anon; role='anon' }
}

function Get-RestError($err) {
  try {
    $resp = $err.Exception.Response
    if ($resp) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      return "HTTP $([int]$resp.StatusCode) : $($sr.ReadToEnd())"
    }
  } catch {}
  return $err.Exception.Message
}

# ---------------------------------------------------------------------------
# Production message history (15 items as provided, in order). No em dashes
# appear in the message bodies, so no $EM injection is needed here. Apostrophes
# are plain ASCII. Double-quoted strings are safe (no $, no backtick, no ").
# ---------------------------------------------------------------------------
$contents = @(
  @{ role="user";      text="Absolutely, my golf swing is all arms, very little turn n getting weight off my right side. Until resigning from SDCC last June, I was walking n carrying my bag normally 3, 18 he rounds weekly. That's what i miss most, the exercise walking" },
  @{ role="assistant"; text="That is a big shift, going from 3 rounds a week carrying your bag to barely being able to turn through the ball. So the sciatica has basically taken away your rotation and you're compensating with your arms just to get through a swing. How long has it been like that since you left the club?" },
  @{ role="user";      text="More than 1.5 years both legs n feet are usually numb before finishing #2" },
  @{ role="assistant"; text="1.5 years of numbness in both legs and feet before you even finish the front nine is serious mate That is not a mobility issue you can stretch your way out of. Has anyone actually assessed what is driving the sciatica or have you just been managing it on your own?" },
  @{ role="user";      text="Yes, my last two choices from Medical Dr's are Epidural shot/shots or surgery" },
  @{ role="assistant"; text="That is a significant crossroads to be at. Epidural or surgery are both serious options. Before going down either of those paths, have you had anyone look at how your body is actually moving and what might be contributing to the load on that nerve?" },
  @{ role="user";      text="Yes, a friend owns 2 Manual Orthopedic PT offices n has consulted w me. My spine is in bad condition, many discs being pinched n one huge gap in L2-3" },
  @{ role="assistant"; text="That is a lot going on structurally. With discs being compressed and that gap at L2-3, it makes sense why the stretching and yoga haven't moved the needle. Has your PT friend given you any direction on what he thinks the safest path forward looks like, or is he also pointing you toward the medical route?" },
  @{ role="user";      text="Just 18 if i can finish, w friends on Wed n 9 w Family Sun. Ill be very happy if i can walk the entire 18 even having to push a golf cart at our course" },
  @{ role="assistant"; text="That is a really honest goal mate. Just being able to walk the full 18 again. Given what your PT friend has found structurally, has he given you any guidance on what movement is safe for you right now or is it more of a wait and see situation?" },
  @{ role="user";      text="Pretty much," },
  @{ role="assistant"; text="Yeah that is pretty much where a lot of people end up with something like this. Managing day to day without a clear plan. Given everything your PT friend has found, is he comfortable with you doing any kind of structured movement work or is it strictly hands off until you decide on the medical route?" },
  @{ role="user";      text="Its the finsl two choices, Epidural or Surgery. Since it takes a couple months to schedule n have an appt, I'm going to schedule an Epidural. The surgery if only under consideration if im unable to do any sort of physical activities" },
  @{ role="assistant"; text="Okay so the epidural is the next step and you have got a couple of months before that happens. In that window, is your PT friend comfortable with you doing any light structured movement work or is it strictly rest until the procedure?" },
  @{ role="user";      text="Just keep moving, walking, swimming, stationary bike, for now, is the plan. I'll see how well it can be executed" }
)

$base = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 3600000
$messages = @()
for ($i = 0; $i -lt $contents.Count; $i++) {
  $messages += [ordered]@{
    role      = $contents[$i].role
    content   = $contents[$i].text
    timestamp = $base + ($i * 60000)
  }
}

# running_summary and profile_facts: em dashes injected via $EM (real U+2014 at runtime).
$running_summary = "Lead came in via welcome flow selecting Both. Has had sciatica for 1.5 years in both legs and feet $EM goes numb before finishing hole 2. Tried stretching, yoga, warming up with no relief. Swing has become all arms with little rotation and poor weight transfer. Was previously very active $EM 3 x 18-hole rounds per week walking and carrying bag at SDCC before resigning June last year. Misses the walking most. Medical doctors have presented epidural shots or surgery as the only two remaining options. PT friend who owns two manual orthopedic PT offices has consulted informally. Spine is in bad condition $EM many compressed discs and one large gap at L2-3. Current humble goal is just to walk the full 18 holes again, even pushing a cart. Has decided to schedule an epidural $EM 2 month wait. Surgery only considered if unable to do any physical activity. Movement clearance confirmed: walking, swimming, stationary bike only until procedure. Post-epidural intent and willingness to pursue structured rehab not yet established."

$profile_facts = [ordered]@{
  timeframe                = "1.5 years of bilateral sciatica. Epidural being scheduled $EM 2 month wait. Surgery only if unable to do any physical activity. Movement clearance confirmed: walking, swimming, stationary bike only until procedure."
  primary_goal             = "Pain/Injuries $EM wants to walk the full 18 again without pain or numbness"
  golf_identity            = "Previously 3 x 18-hole rounds per week walking and carrying bag at SDCC. Now playing just 9-18 holes, pushing a cart. Plays Wed with friends and Sun with family."
  priority_level           = "High pain and motivation but medically restricted right now. Long-term nurture candidate. Reassess post-epidural."
  what_theyve_tried        = "Stretching, yoga, warming up $EM none working. PT friend (owns 2 manual orthopedic PT offices) consulted informally. Medical doctors have offered epidural or surgery as only options."
  current_approach_working = "No $EM in holding pattern. Low impact movement only until epidural. Post-epidural intent unclear."
}

# ---------------------------------------------------------------------------
# Step 1: seed the conversation row
# ---------------------------------------------------------------------------
$cfg  = Get-StagingConfig
$mask = $cfg.key.Substring(0, [Math]::Min(8, $cfg.key.Length)) + "..."
Write-Host "=== Phase F+1 replay test 894431997 (STAGING) ===" -ForegroundColor Cyan
Write-Host "Supabase:    $($cfg.url)"
Write-Host "Auth role:   $($cfg.role)  (key $mask)"
Write-Host "Customer ID: $CUSTOMER_ID"
Write-Host "Seeded msgs: $($messages.Count)  (production paste had 15; brief mentioned 17)"
Write-Host ""

$nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$row = [ordered]@{
  bot_id             = $BOT_ID
  customer_id        = $CUSTOMER_ID
  channel            = "manychat"
  status             = "active"
  conversation_stage = "DIAGNOSTIC"
  lead_intent        = "MEDIUM"
  username           = $USERNAME
  profile_name       = $null
  messages           = $messages
  profile_facts      = $profile_facts
  running_summary    = $running_summary
  contact_type       = "prospect"
  total_messages     = $messages.Count
  updated_at         = $nowIso
  created_at         = $nowIso
}
$rowJson = $row | ConvertTo-Json -Depth 12

$writeHeaders = @{ apikey=$cfg.key; Authorization="Bearer $($cfg.key)"; "Content-Type"="application/json"; Prefer="return=representation" }
$readHeaders  = @{ apikey=$cfg.key; Authorization="Bearer $($cfg.key)" }

try {
  Invoke-RestMethod -Uri "$($cfg.url)/rest/v1/conversations" -Method Post -Headers $writeHeaders -Body $rowJson -TimeoutSec 30 | Out-Null
  $check = Invoke-RestMethod -Uri "$($cfg.url)/rest/v1/conversations?bot_id=eq.$BOT_ID&customer_id=eq.$CUSTOMER_ID&select=conversation_stage,messages" -Method Get -Headers $readHeaders -TimeoutSec 30
  $got = @($check)[0]
  Write-Host "  Seed OK: stage=$($got.conversation_stage) msgs=$(@($got.messages).Count)" -ForegroundColor Green
} catch {
  $msg = Get-RestError $_
  Write-Host "  SEED FAILED: $msg" -ForegroundColor Red
  if ($msg -match '401|403|permission denied|42501') {
    Write-Host '  Anon key blocked for writes. Set $env:SUPABASE_STAGING_SERVICE_KEY and re-run. Stopping.' -ForegroundColor Yellow
  }
  exit 1
}

Write-Host ""
Write-Host "Sleeping 2s for the seed write to settle..." -ForegroundColor DarkGray
Start-Sleep -Seconds 2

# ---------------------------------------------------------------------------
# Step 2: send the exact failing message to the staging Worker
# ---------------------------------------------------------------------------
$webhookBody = [ordered]@{
  channel     = "manychat"
  message     = "Hello, yes, i have KP, so Kaiser's answer for everything is a pill or shot. Seen many Dr's n the final 2 solutions r an Epidural or surgery"
  username    = $USERNAME
  customer_id = $CUSTOMER_ID
} | ConvertTo-Json

Write-Host "=== Sending failing message to staging Worker ===" -ForegroundColor Cyan
Write-Host "  $WORKER"
Write-Host ""

$httpStatus = $null
$data = $null
$errBody = $null
try {
  $resp = Invoke-WebRequest -Uri $WORKER -Method Post -ContentType "application/json" -Body $webhookBody -TimeoutSec 90 -UseBasicParsing
  $httpStatus = [int]$resp.StatusCode
  $data = $resp.Content | ConvertFrom-Json
} catch {
  try {
    $r = $_.Exception.Response
    if ($r) {
      $httpStatus = [int]$r.StatusCode
      $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
      $errBody = $sr.ReadToEnd()
      try { $data = $errBody | ConvertFrom-Json } catch {}
    } else {
      $errBody = $_.Exception.Message
    }
  } catch { $errBody = $_.Exception.Message }
}

# ---------------------------------------------------------------------------
# Step 3: report + verdict
# ---------------------------------------------------------------------------
$reply        = if ($data -and $null -ne $data.bot_reply) { [string]$data.bot_reply } else { "" }
$replyLen     = $reply.Length
$stage        = if ($data) { $data.conversation_stage } else { $null }
$nextAction   = if ($data) { $data.next_action } else { $null }
$finalAction  = if ($data -and $data.debug) { $data.debug.final_action } else { $null }
$isFallback   = ($data -and $data.status -eq "parse_failure_fallback")

Write-Host "========================================================" -ForegroundColor DarkGray
Write-Host "HTTP status:        $httpStatus"
Write-Host "bot_reply length:   $replyLen chars"
Write-Host "bot_reply (first 500):"
Write-Host "  $($reply.Substring(0, [Math]::Min(500, $reply.Length)))" -ForegroundColor Gray
Write-Host "conversation_stage: $stage"
Write-Host "next_action:        $nextAction"
Write-Host "debug.final_action: $finalAction"
Write-Host "parse_failure_fallback fired: $isFallback"
if ($errBody) { Write-Host "error body:         $($errBody.Substring(0, [Math]::Min(800, $errBody.Length)))" -ForegroundColor Red }
Write-Host "========================================================" -ForegroundColor DarkGray
Write-Host ""

if ($httpStatus -eq 200 -and -not $isFallback -and $replyLen -gt 0 -and $stage) {
  Write-Host "VERDICT: PASS (best case)" -ForegroundColor Green
  Write-Host "  HTTP 200, non-empty structured reply. The 2048 token budget was enough; no truncation." -ForegroundColor Green
}
elseif ($httpStatus -eq 200 -and $isFallback) {
  Write-Host "VERDICT: PASS (safety net)" -ForegroundColor Yellow
  Write-Host "  HTTP 200 with empty bot_reply and status=parse_failure_fallback. Truncation still" -ForegroundColor Yellow
  Write-Host "  happened but the safety net caught it and routed the lead to the inbox." -ForegroundColor Yellow
}
else {
  Write-Host "VERDICT: FAIL" -ForegroundColor Red
  Write-Host "  Non-200, or 200 with broken/empty structure and no fallback flag. Neither fix held." -ForegroundColor Red
}

Write-Host ""
Write-Host "Telemetry: run this in a second window BEFORE re-running, from sales-bot/:" -ForegroundColor Cyan
Write-Host "  npx wrangler tail --env staging --format pretty" -ForegroundColor Cyan
Write-Host "Look for:" -ForegroundColor Cyan
Write-Host "  [anthropic] model=... stop_reason=... output_tokens=...   (stop_reason=max_tokens means it truncated)"
Write-Host "  [phase-f] ... sectionsInjected=...GUARDRAILS...           (confirms section injection)"
Write-Host "  On a parse failure also: 'Failed to parse Claude response as JSON' then the parse-failure fallback path"
Write-Host ""
Write-Host "Cleanup when done (staging only):" -ForegroundColor DarkGray
Write-Host "  DELETE conversations + reviews WHERE customer_id LIKE 'tester_replay_894431997_%'"
