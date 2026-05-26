# phase_f1_runner.ps1
# Phase F+1 opt-out regression: 6 HTTP tests against the STAGING Worker.
# Pure HTTP. No DB writes. The only Supabase call is an optional read-only
# priorStage check (item 12), which uses the anon key from .env.staging.

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$WORKER = "https://sales-bot-staging.nellakuate.workers.dev/webhook"
$BOT_ID = "00000000-0000-0000-0000-000000000002"

$OPTOUT  = "Sorry, Shaun, I do not want to continue this thread. Thank you for your consideration!"
$SOFTHES = "Not right now mate, swamped with work this week. Maybe revisit it in a couple weeks?"

# id, label, message, kind (optout|softhes), lead_source (or $null), expectedPriorStage
$TESTS = @(
  @{ t="T1"; label="HOOK BOMBER + OPT-OUT";  id="tester_phase_f1_optout_1779810977_hook";     msg=$OPTOUT;  kind="optout";  username="bot_tester_optout";  src="bomber"; expect=$null },
  @{ t="T2"; label="HOOK BOMBER + SOFT HES"; id="tester_phase_f1_softhes_1779810977_hook";    msg=$SOFTHES; kind="softhes"; username="bot_tester_softhes"; src="bomber"; expect=$null },
  @{ t="T3"; label="GOAL + OPT-OUT";         id="tester_phase_f1_optout_1779810977_goal";     msg=$OPTOUT;  kind="optout";  username="bot_tester_optout";  src=$null;    expect="GOAL" },
  @{ t="T4"; label="GOAL + SOFT HES";        id="tester_phase_f1_softhes_1779810977_goal";    msg=$SOFTHES; kind="softhes"; username="bot_tester_softhes"; src=$null;    expect="GOAL" },
  @{ t="T5"; label="PRIORITY + OPT-OUT";     id="tester_phase_f1_optout_1779810977_priority"; msg=$OPTOUT;  kind="optout";  username="bot_tester_optout";  src=$null;    expect="PRIORITY" },
  @{ t="T6"; label="PRIORITY + SOFT HES";    id="tester_phase_f1_softhes_1779810977_priority";msg=$SOFTHES; kind="softhes"; username="bot_tester_softhes"; src=$null;    expect="PRIORITY" }
)

function Test-OptOutReply([string]$reply) {
  $banned = @('change your mind','if you ever','revisit','down the track','feel free to',
              'reach out','let me know',' share ',' content ',' tips ',' free ','freebie','down the line')
  $low = $reply.ToLower()
  if ($reply -match '\?') { return @{ pass=$false; reason='reply contains "?"' } }
  foreach ($b in $banned) { if ($low.Contains($b)) { return @{ pass=$false; reason="contains banned phrase '$($b.Trim())'" } } }
  if ($reply.Length -ge 100) { return @{ pass=$false; reason="length $($reply.Length) >= 100" } }
  return @{ pass=$true; reason='no question, no nurture phrase, under 100 chars' }
}
function Test-SoftHesReply([string]$reply) {
  $exit = @('all good mate','no worries take care','got it all the best')
  $low = $reply.ToLower()
  foreach ($m in $exit) { if ($low.Contains($m)) { return @{ pass=$false; reason="exited on soft hesitation '$m'" } } }
  $q = if ($reply -match '\?') { 'asked a question' } else { 'no question (informational)' }
  return @{ pass=$true; reason="did not exit; $q" }
}

# Optional read-only priorStage check
function Get-PriorStage([string]$id) {
  try {
    $envPath = Join-Path $PSScriptRoot 'dashboard\.env.staging'
    if (-not (Test-Path $envPath)) { return $null }
    $url=$null; $anon=$null
    foreach ($line in Get-Content $envPath) {
      if ($line -match '^\s*VITE_SUPABASE_URL\s*=\s*(.+?)\s*$')      { $url  = $matches[1].Trim() }
      if ($line -match '^\s*VITE_SUPABASE_ANON_KEY\s*=\s*(.+?)\s*$') { $anon = $matches[1].Trim() }
    }
    if (-not $url -or -not $anon) { return $null }
    $h = @{ apikey=$anon; Authorization="Bearer $anon" }
    $r = Invoke-RestMethod -Uri "$url/rest/v1/conversations?bot_id=eq.$BOT_ID&customer_id=eq.$id&select=conversation_stage" -Headers $h -TimeoutSec 20
    if (@($r).Count -eq 0) { return "(no row)" }
    return @($r)[0].conversation_stage
  } catch { return "(read failed)" }
}

Write-Host "=== Phase F+1 Regression Runner (STAGING) ===" -ForegroundColor Cyan
Write-Host "Worker: $WORKER"
Write-Host ""
$verdicts = @()

foreach ($test in $TESTS) {
  Write-Host "========================================================" -ForegroundColor DarkGray
  Write-Host "[$($test.t)] $($test.label)" -ForegroundColor White
  Write-Host "  Customer ID: $($test.id)"

  $prior = Get-PriorStage $test.id
  if ($null -ne $test.expect) {
    if ($prior -ne $test.expect) {
      Write-Host "  WARNING: priorStage='$prior' but expected '$($test.expect)'. Seeding may be off. Proceeding." -ForegroundColor Yellow
    } else {
      Write-Host "  priorStage: $prior (matches expected)" -ForegroundColor DarkGray
    }
  } else {
    if ($prior -ne "(no row)") {
      Write-Host "  WARNING: expected fresh lead (no row) but found priorStage='$prior'. Run cleanup + clear KV. Proceeding." -ForegroundColor Yellow
    } else {
      Write-Host "  priorStage: (no row, fresh HOOK entry)" -ForegroundColor DarkGray
    }
  }

  Write-Host "  Lead said: $($test.msg)"

  $payload = [ordered]@{
    customer_id  = $test.id
    message      = $test.msg
    channel      = "instagram"
    username     = $test.username
    profile_name = "Test Lead"
  }
  if ($null -ne $test.src) { $payload.lead_source = $test.src }
  $body = $payload | ConvertTo-Json -Depth 5

  try {
    $data = Invoke-RestMethod -Uri $WORKER -Method Post -ContentType "application/json" -Body $body -TimeoutSec 90
    $reply = [string]$data.bot_reply
    Write-Host "  Bot replied: $reply" -ForegroundColor Gray
    Write-Host "  stage=$($data.conversation_stage)  intent=$($data.lead_intent)  next_action=$($data.next_action)  final_action=$($data.debug.final_action)" -ForegroundColor DarkGray

    $eval = if ($test.kind -eq "optout") { Test-OptOutReply $reply } else { Test-SoftHesReply $reply }
    $color = if ($eval.pass) { "Green" } else { "Red" }
    Write-Host "  Verdict: $(if ($eval.pass) {'PASS'} else {'FAIL'})" -ForegroundColor $color
    Write-Host "  Reason: $($eval.reason)" -ForegroundColor $color
    $verdicts += [PSCustomObject]@{ t=$test.t; label=$test.label; pass=$eval.pass }
  } catch {
    Write-Host "  REQUEST FAILED: $($_.Exception.Message)" -ForegroundColor Red
    $verdicts += [PSCustomObject]@{ t=$test.t; label=$test.label; pass=$false }
  }

  Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "=== Phase F+1 Regression Summary ===" -ForegroundColor Cyan
foreach ($v in $verdicts) {
  $status = if ($v.pass) { "PASS" } else { "FAIL" }
  $color  = if ($v.pass) { "Green" } else { "Red" }
  Write-Host ("{0} {1,-26} {2}" -f $v.t, ($v.label + ":"), $status) -ForegroundColor $color
}
$passCount = (@($verdicts | Where-Object { $_.pass })).Count
Write-Host ("=== {0}/{1} PASS ===" -f $passCount, $verdicts.Count) -ForegroundColor Cyan
