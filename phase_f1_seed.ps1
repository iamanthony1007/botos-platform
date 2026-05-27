# phase_f1_seed.ps1
# Seeds the 4 deep-stage conversation rows (T3-T6) into staging conversations.
# STAGING ONLY. Upserts on (bot_id, customer_id) so re-seeding is idempotent.
# Auth strategy identical to phase_f1_cleanup.ps1 (anon by default, service role
# via $env:SUPABASE_STAGING_SERVICE_KEY).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BOT_ID = "00000000-0000-0000-0000-000000000002"

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

# Ascending epoch-ms timestamps starting ~1 hour ago, one per message.
$base = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 3600000
$ti = 0
function NextTs { $script:ti += 60000; return $script:base + $script:ti }
function Msg([string]$role, [string]$content) { return [ordered]@{ role = $role; content = $content; timestamp = (NextTs) } }

# GOAL history: HOOK opener, lead reply, bot GOAL question. Next lead msg arrives via HTTP.
function Build-GoalMessages {
  $script:ti = 0
  return @(
    (Msg "assistant" "Hey mate, appreciate you reaching out. How long have you been playing golf?"),
    (Msg "user"      "About 12 years now, on and off."),
    (Msg "assistant" "Nice, plenty of time on the course then. What are you most wanting to improve right now, distance, consistency, or playing without aches?")
  )
}

# PRIORITY history: full walk HOOK > GOAL > DIAGNOSTIC > INSIGHT > PRIORITY question.
function Build-PriorityMessages {
  $script:ti = 0
  return @(
    (Msg "assistant" "Hey mate, thanks for getting in touch. How long have you been playing golf?"),
    (Msg "user"      "Around 20 years, but the last few have been rough with my back."),
    (Msg "assistant" "Sorry to hear that. What is the main thing you want to sort, distance, consistency, or getting out of pain?"),
    (Msg "user"      "Honestly just want to swing without my lower back flaring up every round."),
    (Msg "assistant" "Got it. When the back flares up, is it more during the backswing or coming through impact?"),
    (Msg "user"      "Mostly coming through impact, feels like it locks up on the left side."),
    (Msg "assistant" "Makes sense. Have you done any structured mobility work for it, or mostly just stretching when it gets sore?"),
    (Msg "user"      "Just stretching here and there, nothing structured."),
    (Msg "assistant" "Yeah that is the common trap, treatment calms it down but the body never rebuilds the rotation, so it keeps flaring. The fix is usually getting the hips and mid back moving so the lower back stops taking the load."),
    (Msg "user"      "That actually makes a lot of sense."),
    (Msg "assistant" "Good. So how much of a priority is getting this sorted for you right now, is it a high priority or more of a nice to have?")
  )
}

$rows = @(
  @{ customer_id="tester_phase_f1_optout_1779810977_goal";     stage="GOAL";     intent="MEDIUM"; username="bot_tester_optout"; profile_name="Test Lead"; summary="Lead, 12 years playing, identifying primary goal."; messages=(Build-GoalMessages) },
  @{ customer_id="tester_phase_f1_softhes_1779810977_goal";    stage="GOAL";     intent="MEDIUM"; username="bot_tester_softhes"; profile_name="Test Lead"; summary="Lead, 12 years playing, identifying primary goal."; messages=(Build-GoalMessages) },
  @{ customer_id="tester_phase_f1_optout_1779810977_priority"; stage="PRIORITY"; intent="MEDIUM"; username="bot_tester_optout"; profile_name="Test Lead"; summary="Lead with lower back pain through impact, no structured work, priority being gauged."; messages=(Build-PriorityMessages) },
  @{ customer_id="tester_phase_f1_softhes_1779810977_priority";stage="PRIORITY"; intent="MEDIUM"; username="bot_tester_softhes"; profile_name="Test Lead"; summary="Lead with lower back pain through impact, no structured work, priority being gauged."; messages=(Build-PriorityMessages) }
)

$cfg = Get-StagingConfig
$mask = $cfg.key.Substring(0, [Math]::Min(8, $cfg.key.Length)) + "..."
Write-Host "=== Phase F+1 seed (STAGING) ===" -ForegroundColor Cyan
Write-Host "Supabase: $($cfg.url)"
Write-Host "Auth role: $($cfg.role)  (key $mask)"
Write-Host ""

$writeHeaders = @{ apikey=$cfg.key; Authorization="Bearer $($cfg.key)"; "Content-Type"="application/json"; Prefer="resolution=merge-duplicates,return=representation" }
$readHeaders  = @{ apikey=$cfg.key; Authorization="Bearer $($cfg.key)" }
$summary = @()

foreach ($r in $rows) {
  $nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $row = [ordered]@{
    bot_id             = $BOT_ID
    customer_id        = $r.customer_id
    channel            = "instagram"
    status             = "active"
    conversation_stage = $r.stage
    messages           = $r.messages
    profile_facts      = @{ test_seed = $true }
    running_summary    = $r.summary
    lead_intent        = $r.intent
    contact_type       = "prospect"
    username           = $r.username
    profile_name       = $r.profile_name
    total_messages     = @($r.messages).Count
    updated_at         = $nowIso
    created_at         = $nowIso
  }
  $bodyJson = $row | ConvertTo-Json -Depth 10
  $uri = "$($cfg.url)/rest/v1/conversations?on_conflict=bot_id,customer_id"
  try {
    Invoke-RestMethod -Uri $uri -Method Post -Headers $writeHeaders -Body $bodyJson -TimeoutSec 30 | Out-Null
    # Read back and confirm stage + message count
    $check = Invoke-RestMethod -Uri "$($cfg.url)/rest/v1/conversations?bot_id=eq.$BOT_ID&customer_id=eq.$($r.customer_id)&select=customer_id,conversation_stage,messages" -Method Get -Headers $readHeaders -TimeoutSec 30
    $got = @($check)[0]
    $stageOk = ($got.conversation_stage -eq $r.stage)
    $msgCount = @($got.messages).Count
    $color = if ($stageOk) { "Green" } else { "Red" }
    Write-Host ("  {0,-46} stage={1,-8} msgs={2}  {3}" -f $r.customer_id, $got.conversation_stage, $msgCount, $(if ($stageOk) { "OK" } else { "STAGE MISMATCH" })) -ForegroundColor $color
    $summary += [PSCustomObject]@{ customer_id=$r.customer_id; seeded_stage=$got.conversation_stage; messages=$msgCount; ok=$stageOk }
  } catch {
    $msg = Get-RestError $_
    Write-Host "  $($r.customer_id) SEED FAILED: $msg" -ForegroundColor Red
    if ($msg -match '401|403|permission denied|42501') {
      Write-Host ""
      Write-Host "  Anon key blocked for writes. Set the service role key and re-run:" -ForegroundColor Yellow
      Write-Host '    $env:SUPABASE_STAGING_SERVICE_KEY = "<service_role key>"' -ForegroundColor Yellow
      Write-Host "  Stopping." -ForegroundColor Yellow
      exit 1
    }
  }
}

Write-Host ""
Write-Host "=== Seed summary ===" -ForegroundColor Cyan
$summary | Format-Table -AutoSize
Write-Host "Reminder: clear KV for these IDs before the runner, or the bot reads stale history (see cleanup script)." -ForegroundColor Yellow
