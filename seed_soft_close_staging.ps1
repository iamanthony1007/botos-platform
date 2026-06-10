# seed_soft_close_staging.ps1
# STAGING ONLY. Seeds 4 conversations in the T+20h follow-up window to test
# the soft-close guard via /__cron-test. Upserts on (bot_id, customer_id).
# Cleanup: cleanup_soft_close_staging.ps1 deletes the same rows.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BOT_ID = "00000000-0000-0000-0000-000000000002"
$URL = "https://hlpucysbaqerhwahfolg.supabase.co"
$KEY = $env:STAGING_SUPABASE_SERVICE_KEY
if (-not $KEY) { throw "STAGING_SUPABASE_SERVICE_KEY not set" }

# Last user message 20.5h ago (inside the [20h, 21h) window), bot reply +60s.
$nowMs   = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$userTs  = $nowMs - [long](20.5 * 3600000)
$botTs   = $userTs + 60000
$openTs  = $userTs - 120000
$updatedAt = [DateTimeOffset]::FromUnixTimeMilliseconds($userTs).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

function Row($cid, $uname, $pname, $userText, $botText) {
  return [ordered]@{
    bot_id             = $BOT_ID
    customer_id        = $cid
    username           = $uname
    profile_name       = $pname
    conversation_stage = "DIAGNOSTIC"
    followed_up        = $false
    for_coach          = $false
    updated_at         = $updatedAt
    messages           = @(
      [ordered]@{ role="assistant"; content="Hey mate, appreciate you reaching out. How long have you been playing golf?"; timestamp=$openTs },
      [ordered]@{ role="user";      content=$userText; timestamp=$userTs },
      [ordered]@{ role="assistant"; content=$botText;  timestamp=$botTs }
    )
  }
}

$rows = @(
  # (a) bot soft-close ack, no question -> MUST skip (soft_close, bot-side)
  (Row "999920001" "sc_guard_a" "Guard Alpha" `
       "Ok cool" `
       "No worries, enjoy the call. We'll pick this up another time."),
  # (b) bot ack ENDS in "?" -> MUST still nudge (question gate)
  (Row "999920002" "sc_guard_b" "Guard Bravo" `
       "Not sure yet" `
       "No worries mate, have you tried any of these before?"),
  # (c) lead parked, bot re-engaged with a question -> MUST skip (lead-side)
  (Row "999920003" "sc_guard_c" "Guard Charlie" `
       "About to get on a Teams call for work. Have a nice day" `
       "Enjoy the call! What are you working on in your game at the moment?"),
  # (d) normal dropped lead, no park phrases -> MUST still nudge
  (Row "999920004" "sc_guard_d" "Guard Delta" `
       "Mostly consistency off the tee" `
       "Got it. Have you done any mobility training before, or is this your first crack at it?")
)

$h = @{ Authorization = "Bearer $KEY"; apikey = $KEY; Prefer = "resolution=merge-duplicates,return=representation" }
$body = ($rows | ConvertTo-Json -Depth 6)
$resp = Invoke-RestMethod -Uri "$URL/rest/v1/conversations?on_conflict=bot_id,customer_id" `
  -Method Post -Headers $h -ContentType "application/json" -Body $body
"seeded $($resp.Count) rows (updated_at=$updatedAt, user ts=$userTs)"
$resp | ForEach-Object { "  $($_.customer_id) $($_.username) followed_up=$($_.followed_up) msgs=$($_.messages.Count)" }
