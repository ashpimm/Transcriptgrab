# Reel download operations

Hooklab can turn any saved carousel with generated visuals into a silent 1080p, 9:16 MP4. The user downloads the file and chooses music inside Instagram.

## Production setup

Set these Vercel environment variables for Production (and Preview if Reel testing is wanted there):

- `SHOTSTACK_API_KEY`: Shotstack API key.
- `SHOTSTACK_ENV`: `stage` while testing or `v1` for production renders. The code defaults to `stage`.
- `REEL_PUBLIC_BASE_URL`: the public production origin, normally `https://transcriptgrab.vercel.app`. This prevents a preview deployment URL or custom-domain mismatch from being sent to Shotstack.
- `REEL_SIGNING_SECRET`: a long random secret. If omitted, the existing `CRON_SECRET` or `ADMIN_SECRET` signs render-only slide links.

After adding or changing an environment variable, redeploy. The Create page reports Reel export as unavailable until `SHOTSTACK_API_KEY` is present in that deployment.

The database columns are created idempotently by the API. `scripts/migrate-reels.sql` is also available for an explicit migration.

## User flow

1. Generate or reopen a carousel whose visuals are ready.
2. Select **Create Reel (.mp4)**.
3. The page polls the durable render job. It is safe to leave; reopening the carousel resumes the visible state.
4. Select **Download Reel (.mp4)** when ready.
5. Upload to Instagram and choose music there.

The video uses slow alternating pan/zoom movement, short fades, longer first/last frames, no soundtrack, and muted output.

## Recovery behavior

- Repeated clicks cannot create duplicate active renders.
- A submission stuck for more than 30 minutes can be reclaimed and retried.
- Provider failures are saved on the carousel and exposed as a retry state.
- Shotstack download URLs are treated as temporary. Hooklab marks them expired after 23 hours and offers a fresh render.
- Signed source-frame URLs expire after two hours and expose only one specific carousel frame.
- Reel frames are JPEG rather than PNG so photo-heavy slides remain below Vercel's serverless response-size limit.

## Verification

Run all tests from the repository root:

```powershell
node --test tests/*.test.mjs
```

For a live check, use a Shotstack stage key, generate a carousel, create a Reel, download it, and confirm it is a silent 1080x1920 MP4. Switch `SHOTSTACK_ENV` to `v1` only when production billing/rendering is intended.
