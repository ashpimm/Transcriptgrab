# Hook mining operations

Manual mining is authenticated with the production `ADMIN_SECRET`. Use an
Authorization header so the secret does not appear in browser history or the
request URL.

## PowerShell setup

```powershell
$promoteBaseUrl = 'https://transcriptgrab.vercel.app'
$adminSecret = (Get-Credential -UserName 'admin' -Message 'Enter ADMIN_SECRET').GetNetworkCredential().Password
$adminHeaders = @{ Authorization = "Bearer $adminSecret" }
```

List the exact active niche slugs:

```powershell
(Invoke-RestMethod -Uri "$promoteBaseUrl/api/hooks").niches |
  Sort-Object name |
  Format-Table name, slug
```

Use one explicit niche at a time. For HUD Plus, start with the slug saved in
its profile; this will usually be `fitness-weight-loss`.

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

$preview.wouldDelete
$preview.errors
```

`dry=1` calls YouTube, Supadata, and Gemini, but performs no database writes.
The rebuild can commit only when at least three hooks pass all quality gates,
at least six usable transcripts were fully evaluated, and the discovery and
upstream services completed without partial failures.

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
- removes obsolete non-curated YouTube hooks for that niche;
- preserves curated hooks and non-YouTube sources;
- updates the niche mining timestamp.

If the completeness checks fail, the endpoint returns HTTP 409 and keeps the
existing inventory unchanged. Any database error rolls the entire replacement
back.

## Batch preview or pre-launch rebuild

The helper script runs niches sequentially, keeps the admin secret in the
Authorization header, continues past a blocked niche, and can save a complete
secret-free report.

Run it through Vercel's in-memory environment runner so production secrets are
not written to a local file:

```powershell
# Preview every active niche.
npx --yes vercel@latest env run -e production -- `
  node scripts/fresh-mine.mjs --all `
  --report="$env:TEMP\hook-mining-preview.json"

# Apply every healthy rebuild. A blocked niche keeps its existing hooks.
npx --yes vercel@latest env run -e production -- `
  node scripts/fresh-mine.mjs --all --apply --confirm=FRESH_REBUILD `
  --report="$env:TEMP\hook-mining-apply.json"
```

Each pass can use up to 600 YouTube search quota units per niche because the
miner checks up to six search phrases. Avoid immediately running an all-niche
preview and an all-niche apply on the same day unless the YouTube project has
enough remaining quota. The apply route independently performs the same
completeness checks and atomically keeps the current rows when a new batch is
not healthy, so a one-pass pre-launch apply is the quota-efficient option.

## Routine mine

Omitting both `dry=1` and `fresh=1` runs the normal incremental miner. It adds
newly discovered hooks and refreshes source statistics, but does not remove the
rest of the niche inventory:

```powershell
Invoke-RestMethod `
  -Uri "$promoteBaseUrl/api/mine?niche=$nicheSlug" `
  -Headers $adminHeaders
```

When finished, remove the secret from the current PowerShell session:

```powershell
Remove-Variable adminSecret, adminHeaders
```
