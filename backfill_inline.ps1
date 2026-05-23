# Phase F-bugfix backfill, inline edition.
# Reads keys from env vars (don't paste into script). Wipe with Remove-Variable at end.

# === Inline configuration ===
$SUPABASE_URL = "https://rydkwsjwlgnivlwlvqku.supabase.co"
$BOT_ID = "00000000-0000-0000-0000-000000000002"
$SUPABASE_SERVICE_KEY = $env:SUPABASE_SERVICE_KEY
$VOYAGE_API_KEY = $env:VOYAGE_API_KEY

if (-not $SUPABASE_SERVICE_KEY) {
    Write-Host "ERROR: env:SUPABASE_SERVICE_KEY not set." -ForegroundColor Red
    exit 1
}
if (-not $VOYAGE_API_KEY) {
    Write-Host "ERROR: env:VOYAGE_API_KEY not set." -ForegroundColor Red
    exit 1
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

Write-Host "=== Phase F-bugfix backfill (production) ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: fetch orphan learnings
Write-Host "Fetching learnings with NULL embedding..." -ForegroundColor Yellow
$supabaseHeaders = @{
    "Authorization" = "Bearer $SUPABASE_SERVICE_KEY"
    "apikey" = $SUPABASE_SERVICE_KEY
}

$query = "$SUPABASE_URL/rest/v1/learnings?bot_id=eq.$BOT_ID&embedding=is.null&select=id,original_reply,corrected_reply,reason,conversation_stage,created_at&order=created_at.asc"
try {
    $orphans = Invoke-RestMethod -Uri $query -Method GET -Headers $supabaseHeaders
} catch {
    Write-Host "ERROR fetching orphans: $($_.Exception.Message)" -ForegroundColor Red
    exit 2
}

# Force into array even if 1 result (PowerShell quirk)
$orphans = @($orphans)

Write-Host "Found $($orphans.Count) orphan learnings to backfill." -ForegroundColor Green
Write-Host ""

if ($orphans.Count -eq 0) {
    Write-Host "Nothing to do. Exiting." -ForegroundColor Cyan
    exit 0
}

$successCount = 0
$failCount = 0
$skipCount = 0
$idx = 0

foreach ($l in $orphans) {
    $idx++
    Write-Host "[$idx/$($orphans.Count)] $($l.id) ($($l.conversation_stage))..." -ForegroundColor Yellow -NoNewline

    # Build embed text (same strategy as Worker fix)
    $parts = @()
    if ($l.original_reply -and $l.original_reply.Trim().Length -gt 0) {
        $parts += $l.original_reply.Trim()
    }
    if ($l.corrected_reply -and $l.corrected_reply.Trim().Length -gt 0) {
        $parts += "Corrected to: " + $l.corrected_reply.Trim()
    }
    if ($l.reason -and $l.reason.Trim().Length -gt 0) {
        $parts += "Reason: " + $l.reason.Trim()
    }
    $embedText = $parts -join "`n`n"

    if ($embedText.Length -lt 10) {
        Write-Host " SKIP (text too short, len=$($embedText.Length))" -ForegroundColor DarkYellow
        $skipCount++
        continue
    }

    # Truncate to 8000 chars to stay within Voyage limits
    if ($embedText.Length -gt 8000) {
        $embedText = $embedText.Substring(0, 8000)
    }

    # Call Voyage
    try {
        $voyagePayload = @{
            input = @($embedText)
            model = "voyage-4"
            input_type = "document"
        } | ConvertTo-Json -Compress

        $voyageHeaders = @{
            "Authorization" = "Bearer $VOYAGE_API_KEY"
            "Content-Type" = "application/json"
        }

        $voyageResp = Invoke-RestMethod -Uri "https://api.voyageai.com/v1/embeddings" -Method POST -Headers $voyageHeaders -Body $voyagePayload
        $embedding = $voyageResp.data[0].embedding

        if (-not $embedding -or $embedding.Count -ne 1024) {
            Write-Host " FAIL (bad embedding, count=$($embedding.Count))" -ForegroundColor Red
            $failCount++
            Start-Sleep -Milliseconds 200
            continue
        }

        # Convert to pgvector text format: [0.1,0.2,...]
        $embeddingStr = "[" + ($embedding -join ",") + "]"

        # PATCH the row
        $patchHeaders = @{
            "Authorization" = "Bearer $SUPABASE_SERVICE_KEY"
            "apikey" = $SUPABASE_SERVICE_KEY
            "Content-Type" = "application/json"
            "Prefer" = "return=minimal"
        }
        $patchBody = @{ embedding = $embeddingStr } | ConvertTo-Json -Compress

        $patchUri = "$SUPABASE_URL/rest/v1/learnings?id=eq.$($l.id)"
        Invoke-RestMethod -Uri $patchUri -Method PATCH -Headers $patchHeaders -Body $patchBody | Out-Null

        Write-Host " OK (dim=$($embedding.Count))" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host " FAIL: $($_.Exception.Message)" -ForegroundColor Red
        $failCount++
    }

    # Rate limit: 200ms between Voyage calls
    Start-Sleep -Milliseconds 200
}

Write-Host ""
Write-Host "=== Backfill complete ===" -ForegroundColor Cyan
Write-Host "  Successful: $successCount" -ForegroundColor Green
Write-Host "  Skipped: $skipCount" -ForegroundColor Yellow
Write-Host "  Failed: $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
