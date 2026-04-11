# Import Feedback to Sales Bot - Handles Special Characters
# Place this script in the same folder as your CSV file

$csvPath = "IG_DM_Learning_File_-_Learning_Log__2_.csv"
$botUrl = "https://sales-bot.iamanthony1007.workers.dev/import-feedback"
$batchSize = 20  # Process 20 rows at a time

# Check if file exists
if (-not (Test-Path $csvPath)) {
    Write-Host "❌ CSV file not found: $csvPath" -ForegroundColor Red
    Write-Host "Please make sure the CSV is in the same folder as this script"
    exit
}

# Read CSV
Write-Host "📖 Reading CSV file..." -ForegroundColor Cyan
$csv = Import-Csv $csvPath -Encoding UTF8

Write-Host "Found $($csv.Count) rows" -ForegroundColor Green
Write-Host ""

# Function to clean text
function Clean-Text {
    param($text)
    if ([string]::IsNullOrWhiteSpace($text)) { return "" }
    
    # Remove line breaks and carriage returns
    $cleaned = $text -replace "`r`n", " " -replace "`n", " " -replace "`r", " "
    
    # Replace quotes with single quotes
    $cleaned = $cleaned -replace '"', "'"
    
    # Remove multiple spaces
    $cleaned = $cleaned -replace '\s+', ' '
    
    # Trim
    $cleaned = $cleaned.Trim()
    
    return $cleaned
}

# Process in batches
$totalBatches = [Math]::Ceiling($csv.Count / $batchSize)
$totalImported = 0
$totalFailed = 0

for ($i = 0; $i -lt $csv.Count; $i += $batchSize) {
    $batchNumber = [Math]::Floor($i / $batchSize) + 1
    
    Write-Host "Processing batch $batchNumber of $totalBatches..." -ForegroundColor Yellow
    
    # Get current batch
    $endIndex = [Math]::Min($i + $batchSize - 1, $csv.Count - 1)
    $batch = $csv[$i..$endIndex]
    
    # Convert batch to proper format
    $feedbackData = @()
    
    foreach ($row in $batch) {
        # Skip rows without required fields
        if ([string]::IsNullOrWhiteSpace($row.'Customer ID') -or 
            [string]::IsNullOrWhiteSpace($row.'Original Bot Reply') -or
            [string]::IsNullOrWhiteSpace($row.'Edited Reply')) {
            Write-Host "  ⚠️  Skipping row with missing data" -ForegroundColor DarkYellow
            continue
        }
        
        $feedbackData += @{
            customer_id = Clean-Text $row.'Customer ID'
            original_reply = Clean-Text $row.'Original Bot Reply'
            edited_reply = Clean-Text $row.'Edited Reply'
            edit_reason = Clean-Text $row.'Edit Reason'
            conversation_stage = if ($row.'Conversation Stage') { $row.'Conversation Stage' } else { "UNKNOWN" }
            decision_type = if ($row.'Decision Type') { $row.'Decision Type' } else { "UNKNOWN" }
            date = if ($row.'Date') { $row.'Date' } else { "" }
        }
    }
    
    if ($feedbackData.Count -eq 0) {
        Write-Host "  ⚠️  No valid data in this batch, skipping" -ForegroundColor DarkYellow
        continue
    }
    
    # Create JSON payload
    $payload = @{
        feedback_data = $feedbackData
    } | ConvertTo-Json -Depth 10 -Compress
    
    # Import to bot
    try {
        $result = Invoke-RestMethod -Uri $botUrl -Method POST -Body $payload -ContentType "application/json; charset=utf-8" -ErrorAction Stop
        
        $totalImported += $result.results.imported
        $totalFailed += $result.results.failed
        
        Write-Host "  ✅ Batch $batchNumber`: Imported $($result.results.imported), Failed $($result.results.failed)" -ForegroundColor Green
        
        if ($result.results.failed -gt 0 -and $result.results.errors) {
            Write-Host "    Errors:" -ForegroundColor Red
            $result.results.errors | Select-Object -First 2 | ForEach-Object {
                Write-Host "      - $($_.error)" -ForegroundColor Red
            }
        }
    }
    catch {
        Write-Host "  ❌ Batch $batchNumber failed: $($_.Exception.Message)" -ForegroundColor Red
        $totalFailed += $feedbackData.Count
    }
    
    # Small delay between batches
    if ($i + $batchSize -lt $csv.Count) {
        Start-Sleep -Milliseconds 500
    }
}

Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✅ Import Complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Total Imported: $totalImported" -ForegroundColor Green
Write-Host "Total Failed: $totalFailed" -ForegroundColor $(if ($totalFailed -gt 0) { "Red" } else { "Green" })
Write-Host ""

# Check stats
Write-Host "Fetching bot stats..." -ForegroundColor Cyan
try {
    $stats = Invoke-RestMethod -Uri "https://sales-bot.iamanthony1007.workers.dev/stats" -Method GET
    Write-Host "Total feedback in bot: $($stats.total_feedback)" -ForegroundColor Green
    Write-Host "Approval rate: $($stats.recent_100.approval_rate)" -ForegroundColor Green
}
catch {
    Write-Host "Could not fetch stats" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
