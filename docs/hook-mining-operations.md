# Hook mining operations

Manual mining uses the same `ADMIN_SECRET` that is already configured in
Vercel. Do not create a second secret for this workflow. The commands below
hold it only in the current PowerShell process and send it in an Authorization
header, so it does not appear in browser history or the request URL.

## PowerShell setup

```powershell
$promoteBaseUrl = 'https://transcriptgrab.vercel.app'
$adminSecret = (Get-Credential -UserName 'admin' -Message 'Enter ADMIN_SECRET').GetNetworkCredential().Password
$adminHeaders = @{ Authorization = "Bearer $adminSecret" }
```

List the active niche slugs before mining:

```powershell
(Invoke-RestMethod -Uri "$promoteBaseUrl/api/hooks").niches |
  Sort-Object name |
  Format-Table name, slug
```

Use one explicit niche at a time. For HUD Plus, start with the slug saved in
its profile; this will usually be `fitness-weight-loss`.

## Repair the production niche catalogue once

If the list still contains legacy pools such as `appdev`, `fitness`, or the
small generated fitness variants, preview the idempotent catalogue repair:

```powershell
$repairPreview = Invoke-RestMethod `
  -Uri "$promoteBaseUrl/api/mine?action=repair-niches" `
  -Headers $adminHeaders

$repairPreview | ConvertTo-Json -Depth 10
```

Apply the reviewed repair with a POST. This consolidates legacy rows into the
canonical audience pools while preserving hook IDs and saved references, then
deactivates the legacy rows. It also retires the old hand-written placeholder
hooks: generation now fails closed when no source-backed hook passes the fit
screen instead of quietly shipping a generic fallback.

```powershell
$repairBody = @{
  action = 'repair-niches'
  confirm = 'REPAIR_NICHES'
} | ConvertTo-Json

$repairResult = Invoke-RestMethod `
  -Method Post `
  -Uri "$promoteBaseUrl/api/mine?action=repair-niches" `
  -Headers $adminHeaders `
  -ContentType 'application/json' `
  -Body $repairBody

$repairResult | ConvertTo-Json -Depth 10
```

Run the active-niche listing again after the repair. `--launch` and `--all`
deliberately refuse to run until every known legacy row is inactive.

## Preview a fresh rebuild

```powershell
$nicheSlug = 'fitness-weight-loss'
$preview = Invoke-RestMethod `
  -Uri "$promoteBaseUrl/api/mine?niche=$nicheSlug&dry=1&fresh=1" `
  -Headers $adminHeaders

$preview |
  Select-Object niche, scanned, outliers, transcriptAttempts,
    transcriptEligible, transcriptFailures, accepted, rejected, currentMined, finalMined,
    minimumAccepted, minimumTranscriptEligible, canApplyFresh, freshBlockers |
  Format-List

$preview.wouldInsert |
  Format-Table views, videoTitle, hookVerbatim, hookTemplate, videoUrl -Wrap

$preview.wouldReplace |
  Format-Table views, videoTitle, hookVerbatim, hookTemplate, videoUrl -Wrap

$preview.wouldRetire
$preview.errors
```

`dry=1` calls YouTube, Supadata, and Gemini, but performs no database writes.
The response includes the currently enforced minimums and every blocker. A
rebuild can commit only when its quality and completeness gates pass and the
discovery and upstream services complete without a partial failure.

To save the complete preview:

```powershell
$preview |
  ConvertTo-Json -Depth 10 |
  Set-Content -LiteralPath ".\dry-$nicheSlug.json" -Encoding utf8
```

## Commit the fresh rebuild

After the preview looks healthy, remove only `dry=1`:

```powershell
$result = Invoke-RestMethod `
  -Uri "$promoteBaseUrl/api/mine?niche=$nicheSlug&fresh=1" `
  -Headers $adminHeaders

$result | ConvertTo-Json -Depth 10
```

The commit call deliberately reruns live discovery and extraction; it does not
replay the preview payload. Its exact hooks can therefore differ slightly from
the preview, but it applies the same completeness checks before replacing data.

This re-runs discovery and extraction, then atomically:

- fully updates accepted hooks;
- inserts newly accepted hooks;
- retires obsolete non-curated YouTube hooks for that niche without destroying
  their saved-reference history;
- preserves non-YouTube and historical placeholder rows for audit history,
  while product-facing queries keep placeholders unavailable;
- updates the niche mining timestamp.

If the completeness checks fail, the endpoint returns HTTP 409 and keeps the
existing inventory unchanged. Any database error rolls the entire replacement
back.

## Batch preview or pre-launch rebuild

The helper script runs niches sequentially, keeps the admin secret in the
Authorization header, continues past a blocked niche, and can save a complete
secret-free report. `--launch` uses the reviewed, ordered launch batch.
`--all` and `--launch` refuse to start while any known legacy niche is still
active.

Put the same secret already entered above into the child process, run the
helper, and remove it afterward:

```powershell
$env:ADMIN_SECRET = $adminSecret

try {
  # Quota-efficient pre-launch pass. Each niche is independently protected by
  # the server's completeness gate; a blocked niche keeps its existing hooks.
  node scripts/fresh-mine.mjs --launch --apply --confirm=FRESH_REBUILD `
    --report="$env:TEMP\hook-mining-apply.json"
} finally {
  Remove-Item Env:ADMIN_SECRET -ErrorAction SilentlyContinue
}
```

The miner makes at most six keyword searches and three seed-channel searches
per niche: nine YouTube search requests in the worst case. The default YouTube
search bucket is [100 requests per day, at one unit per call](https://developers.google.com/youtube/v3/determine_quota_cost).
The helper stops any pass whose
worst-case estimate exceeds 90, leaving a ten-request buffer. After checking
the project's usage, a deliberate larger pass can be allowed with
`--allow-over-90-search-requests`.

A fresh pass can also attempt up to 30 Supadata transcript fetches per niche,
or 300 across the ten-pool launch batch. Check the Supadata plan's remaining
credits before starting the full batch. Transcript failures count against the
fresh completeness gate; they never cause the miner to publish ungrounded
hooks.

Avoid running a launch preview and a launch apply on the same day unless there
is enough search capacity for both. The apply route independently performs the
same completeness checks and returns HTTP 409 without changing existing hooks
when a new batch is not healthy, so one direct apply is the quota-efficient
pre-launch option.

Runner outcomes mean:

- `APPLIED`: the fresh inventory committed.
- `KEPT EXISTING`: the apply returned HTTP 409 and preserved the old inventory.
- `BLOCKED`: a dry preview completed, but its quality/completeness gate failed.
- `FAILED`: an authentication, server, malformed-success, or other HTTP error
  occurred. Any non-2xx response is a failure except HTTP 409 during apply.

To target only one or two pools:

```powershell
$env:ADMIN_SECRET = $adminSecret
try {
  node scripts/fresh-mine.mjs `
    --niches=fitness-weight-loss,productivity-focus `
    --apply --confirm=FRESH_REBUILD `
    --report="$env:TEMP\hook-mining-targeted.json"
} finally {
  Remove-Item Env:ADMIN_SECRET -ErrorAction SilentlyContinue
}
```

## Routine mine

Omitting both `dry=1` and `fresh=1` runs the normal incremental miner. It adds
newly discovered hooks and refreshes source statistics, but does not remove the
rest of the niche inventory:

```powershell
Invoke-RestMethod `
  -Uri "$promoteBaseUrl/api/mine?niche=$nicheSlug" `
  -Headers $adminHeaders
```

## Browser fallback

The endpoint still accepts the same existing secret as a `secret` query
parameter when a browser-only run is more convenient:

```text
https://transcriptgrab.vercel.app/api/mine?niche=fitness-weight-loss&fresh=1&secret=PASTE_ADMIN_SECRET
```

This exposes the secret to browser history and potentially request logs. Use
the Authorization-header commands for batch work; if the browser form is used,
remove the URL from browser history afterward.

When finished, remove the secret from the current PowerShell session:

```powershell
Remove-Item Env:ADMIN_SECRET -ErrorAction SilentlyContinue
Remove-Variable adminSecret, adminHeaders
```
