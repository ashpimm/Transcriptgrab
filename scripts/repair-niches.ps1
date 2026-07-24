# scripts/repair-niches.ps1 — preview or apply the canonical niche catalogue
# repair on prod (seeds new canonical niches, merges/retires legacy ones).
#
# Usage (ADMIN_SECRET must be set in this window first):
#   .\scripts\repair-niches.ps1          # preview, no changes
#   .\scripts\repair-niches.ps1 -Apply   # apply
param([switch]$Apply)
$ErrorActionPreference = 'Stop'

if (-not $env:ADMIN_SECRET) { throw 'Set $env:ADMIN_SECRET first.' }
$secret = $env:ADMIN_SECRET -replace "`r|`n", ''
$headers = @{ Authorization = "Bearer $secret" }
$uri = 'https://transcriptgrab.vercel.app/api/mine?action=repair-niches'

if ($Apply) {
  $result = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body '{"confirm":"REPAIR_NICHES"}'
} else {
  $result = Invoke-RestMethod -Uri $uri -Headers $headers
}
$result | ConvertTo-Json -Depth 6
