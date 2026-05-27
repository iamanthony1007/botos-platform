# phase_f1_cleanup.ps1
# Deletes staging conversations + reviews rows matching the Phase F+1 test ID pattern.
# STAGING ONLY. Pure PostgREST. No production endpoints referenced.
# Auth: reads anon key from dashboard/.env.staging by default. To escalate to
# service role, set $env:SUPABASE_STAGING_SERVICE_KEY before running (sourced
# from Supabase Dashboard > Settings > API > service_role) and it will be used.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BOT_ID  = "00000000-0000-0000-0000-000000000002"
$PATTERN = "like.tester_phase_f1_*_1779810977*"   # PostgREST maps * to SQL %

$CUSTOMER_IDS = @(
  "tester_phase_f1_optout_1779810977_hook",
  "tester_phase_f1_softhes_1779810977_hook",
  "tester_phase_f1_optout_1779810977_goal",
  "tester_phase_f1_softhes_1779810977_goal",
  "tester_phase_f1_optout_1779810977_priority",
  "tester_phase_f1_softhes_1779810977_priority"
)

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
      $body = $sr.ReadToEnd()
      return "HTTP $([int]$resp.StatusCode) : $body"
    }
  } catch {}
  return $err.Exception.Message
}

$cfg = Get-StagingConfig
$mask = $cfg.key.Substring(0, [Math]::Min(8, $cfg.key.Length)) + "..."
Write-Host "=== Phase F+1 cleanup (STAGING) ===" -ForegroundColor Cyan
Write-Host "Supabase: $($cfg.url)"
Write-Host "Auth role: $($cfg.role)  (key $mask)"
Write-Host ""

$headers = @{ apikey = $cfg.key; Authorization = "Bearer $($cfg.key)"; Prefer = "return=representation" }

foreach ($table in @("conversations","reviews")) {
  $uri = "$($cfg.url)/rest/v1/$table`?customer_id=$PATTERN"
  try {
    $deleted = Invoke-RestMethod -Uri $uri -Method Delete -Headers $headers -TimeoutSec 30
    $count = if ($null -eq $deleted) { 0 } else { @($deleted).Count }
    Write-Host ("  {0,-15} deleted {1} row(s)" -f $table, $count) -ForegroundColor Green
  } catch {
    $msg = Get-RestError $_
    Write-Host "  $table DELETE FAILED: $msg" -ForegroundColor Red
    if ($msg -match '401|403|permission denied|42501') {
      Write-Host ""
      Write-Host "  Anon key appears blocked for writes. Set the service role key and re-run:" -ForegroundColor Yellow
      Write-Host '    $env:SUPABASE_STAGING_SERVICE_KEY = "<service_role key from Supabase Dashboard > Settings > API>"' -ForegroundColor Yellow
      Write-Host "  Then run this script again. Stopping." -ForegroundColor Yellow
      exit 1
    }
  }
}

Write-Host ""
Write-Host "NOTE: KV memory is NOT cleaned by this script. For a fully clean run," -ForegroundColor Yellow
Write-Host "clear these 6 keys in the staging KV namespace (id e1bc76417c284a3ebd82758623e1d148):" -ForegroundColor Yellow
foreach ($id in $CUSTOMER_IDS) {
  Write-Host ('  npx wrangler kv key delete "memory:{0}" --namespace-id e1bc76417c284a3ebd82758623e1d148 --remote' -f $id)
}
Write-Host ""
Write-Host "Cleanup complete." -ForegroundColor Cyan
