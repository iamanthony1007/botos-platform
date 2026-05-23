# Phase F-bugfix backfill: one-off retry for row 384576c2 with smart-quote normalisation.

$SUPABASE_URL = "https://rydkwsjwlgnivlwlvqku.supabase.co"
$BOT_ID = "00000000-0000-0000-0000-000000000002"
$ORPHAN_ID = "384576c2-d222-41cf-b1da-0bafc21840f6"
$SUPABASE_SERVICE_KEY = $env:SUPABASE_SERVICE_KEY
$VOYAGE_API_KEY = $env:VOYAGE_API_KEY

if (-not $SUPABASE_SERVICE_KEY -or -not $VOYAGE_API_KEY) {
    Write-Host "ERROR: env vars not set" -ForegroundColor Red
    exit 1
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

Write-Host "Fetching orphan row $ORPHAN_ID..." -ForegroundColor Yellow

$supabaseHeaders = @{
    "Authorization" = "Bearer $SUPABASE_SERVICE_KEY"
    "apikey" = $SUPABASE_SERVICE_KEY
}

$query = "$SUPABASE_URL/rest/v1/learnings?id=eq.$ORPHAN_ID&select=id,original_reply,corrected_reply,reason"
$row = (Invoke-RestMethod -Uri $query -Method GET -Headers $supabaseHeaders)[0]

Write-Host "Row found. original_len=$($row.original_reply.Length), corrected_len=$($row.corrected_reply.Length), reason_len=$($row.reason.Length)" -ForegroundColor Cyan

# Function to normalise smart quotes and other problematic Unicode to ASCII equivalents
function Normalize-Text($text) {
    if (-not $text) { return "" }
    # Curly double quotes (U+201C, U+201D) -> straight "
    $text = $text -replace "[\u201C\u201D]", '"'
    # Curly single quotes / apostrophes (U+2018, U+2019) -> straight '
    $text = $text -replace "[\u2018\u2019]", "'"
    # Em dash (U+2014) -> two hyphens
    $text = $text -replace "\u2014", "--"
    # En dash (U+2013) -> hyphen
    $text = $text -replace "\u2013", "-"
    # Ellipsis (U+2026) -> three dots
    $text = $text -replace "\u2026", "..."
    # Non-breaking space (U+00A0) -> regular space
    $text = $text -replace "\u00A0", " "
    return $text
}

# Build embed text with normalisation
$parts = @()
$origNorm = Normalize-Text $row.original_reply
if ($origNorm.Trim().Length -gt 0) { $parts += $origNorm.Trim() }

$corrNorm = Normalize-Text $row.corrected_reply
if ($corrNorm.Trim().Length -gt 0) { $parts += "Corrected to: " + $corrNorm.Trim() }

$reasonNorm = Normalize-Text $row.reason
if ($reasonNorm.Trim().Length -gt 0) { $parts += "Reason: " + $reasonNorm.Trim() }

$embedText = $parts -join "`n`n"

if ($embedText.Length -gt 8000) {
    $embedText = $embedText.Substring(0, 8000)
}

Write-Host "Embed text length after normalisation: $($embedText.Length) chars" -ForegroundColor Cyan
Write-Host "Calling Voyage..." -ForegroundColor Yellow

$voyagePayload = @{
    input = @($embedText)
    model = "voyage-4"
    input_type = "document"
} | ConvertTo-Json -Compress

$voyageHeaders = @{
    "Authorization" = "Bearer $VOYAGE_API_KEY"
    "Content-Type" = "application/json"
}

try {
    $voyageResp = Invoke-RestMethod -Uri "https://api.voyageai.com/v1/embeddings" -Method POST -Headers $voyageHeaders -Body $voyagePayload
    $embedding = $voyageResp.data[0].embedding

    if (-not $embedding -or $embedding.Count -ne 1024) {
        Write-Host "FAIL: bad embedding (count=$($embedding.Count))" -ForegroundColor Red
        exit 2
    }

    Write-Host "Voyage returned embedding dim=$($embedding.Count). PATCHing Supabase..." -ForegroundColor Green

    $embeddingStr = "[" + ($embedding -join ",") + "]"
    $patchHeaders = @{
        "Authorization" = "Bearer $SUPABASE_SERVICE_KEY"
        "apikey" = $SUPABASE_SERVICE_KEY
        "Content-Type" = "application/json"
        "Prefer" = "return=minimal"
    }
    $patchBody = @{ embedding = $embeddingStr } | ConvertTo-Json -Compress
    $patchUri = "$SUPABASE_URL/rest/v1/learnings?id=eq.$ORPHAN_ID"
    Invoke-RestMethod -Uri $patchUri -Method PATCH -Headers $patchHeaders -Body $patchBody | Out-Null

    Write-Host "SUCCESS. Row $ORPHAN_ID now has embedding." -ForegroundColor Green
} catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    # Try to extract Voyage's error response body for diagnostics
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
            Write-Host "Voyage response body: $body" -ForegroundColor DarkRed
        } catch {}
    }
    exit 3
}
