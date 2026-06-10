# cleanup_soft_close_staging.ps1
# STAGING ONLY. Deletes the 4 soft-close-guard tester rows seeded by
# seed_soft_close_staging.ps1 (customer_id 999920001..999920004).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$KEY = $env:STAGING_SUPABASE_SERVICE_KEY
if (-not $KEY) { throw "STAGING_SUPABASE_SERVICE_KEY not set" }
$h = @{ Authorization = "Bearer $KEY"; apikey = $KEY; Prefer = "return=representation" }
$u = "https://hlpucysbaqerhwahfolg.supabase.co/rest/v1/conversations?bot_id=eq.00000000-0000-0000-0000-000000000002&customer_id=in.(999920001,999920002,999920003,999920004)"
$deleted = Invoke-RestMethod -Uri $u -Method Delete -Headers $h
"deleted $($deleted.Count) rows: $($deleted.customer_id -join ', ')"
# verify gone
$h2 = @{ Authorization = "Bearer $KEY"; apikey = $KEY }
$left = Invoke-RestMethod -Uri "$u&select=customer_id" -Headers $h2
"remaining: $($left.Count)"
