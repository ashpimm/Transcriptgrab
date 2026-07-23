# TikTok mining options

**Status:** Decision record — proposed, not implemented  
**Reviewed:** 23 July 2026

## Decision

Do not enable automated TikTok ingestion in production yet.

If the owner explicitly accepts the TikTok terms and platform-enforcement risk,
the preferred next step is a small, dry-only pilot using:

1. [Apify's maintained TikTok Scraper](https://apify.com/clockworks/tiktok-scraper)
   for public-video discovery and engagement metadata; and
2. the app's existing
   [Supadata transcript API](https://docs.supadata.ai/get-transcript) for
   transcripts.

The pilot must remain dormant until that explicit decision. This document does
not mean TikTok ingestion has been built or enabled.

## Why TikTok's official APIs do not solve this

The app needs commercial, niche-based discovery of high-view public videos,
plus engagement data and spoken transcripts. TikTok currently documents no
official API that provides that combination to this Australian commercial app:

- The [Display API](https://developers.tiktok.com/doc/display-api-overview)
  reads recent public videos belonging to a creator who authorizes the app. It
  is not platform-wide keyword or trend discovery.
- The [Research API](https://developers.tiktok.com/products/research-api/)
  can query public videos and exposes fields including view counts and
  `voice_to_text`, but applicants must be eligible, independent of commercial
  interests, and conducting non-commercial public-interest research. TikTok
  also states that commercial users are ineligible. Australia is not among the
  documented eligible regions.
- The
  [Commercial Content API](https://developers.tiktok.com/products/commercial-content-api)
  searches ads and other commercial content, not the organic niche videos this
  miner needs, and currently documents EU content only.
- [TikTok oEmbed](https://developers.tiktok.com/doc/embed-videos/) is useful for
  displaying and attributing a video whose URL is already known, but it does
  not provide discovery, view counts, or transcripts.
- [Creative Center](https://ads.tiktok.com/help/article/creative-center) is a
  useful manual research and validation surface. TikTok does not document it
  as a bulk discovery API.

## Terms and operational risk

TikTok's terms for Australia and other covered regions prohibit using automated
scripts to collect information and prohibit commercial or unauthorized use
without TikTok's express written consent. See the
[TikTok terms for other regions](https://www.tiktok.com/legal/page/row/terms-of-service/en).

Using Apify or another provider does not itself grant TikTok authorization.
Apify also places responsibility for authorized and lawful use of collected
data on the customer in its
[general terms](https://docs.apify.com/legal/general-terms-and-conditions).
This is a contractual and platform-enforcement risk assessment, not legal
advice. Obtain appropriate Australian legal advice before production use.

## Recommended pilot

After explicit risk acceptance:

1. Run the pilot manually or from an out-of-band worker, never in a customer
   request or the current short Vercel cron.
2. Add `APIFY_TOKEN` only when the pilot is approved. Use Apify keyword search
   for three canonical niches and collect public URLs plus views, likes,
   shares, dates, and creator metadata.
3. Rank candidates primarily by absolute reach, not low follower count. Apply
   the same freshness, relevance, advertising, transcript-grounding, and hook
   quality gates used for YouTube.
4. Send only the strongest candidates to Supadata. Supadata officially supports
   [TikTok transcripts](https://supadata.ai/tiktok-transcript-api), including
   AI fallback when native captions are unavailable.
5. Produce a dry report for comparison with the equivalent YouTube batches.
   Do not write TikTok hooks until the report meets agreed quality and quantity
   thresholds.
6. Store only accepted hook material, metrics, attribution, and the canonical
   source URL. Do not retain downloaded video/audio or full transcripts.
7. Keep YouTube as the fallback and add a kill switch so a provider failure
   cannot affect generation.

Apify currently advertises pricing from US$1.70 per 1,000 results, before
selected add-ons. Supadata charges one credit for a native transcript and two
credits per generated transcript minute. Verify live pricing before enabling a
paid run.

## Required engineering before a pilot

- Supadata can return HTTP `202` with an asynchronous transcription job. The
  current transcript helper treats `202` as a failure, so job polling, timeout,
  and retry handling are required.
- Discovery and mining currently assume YouTube candidate fields and URLs. Add
  a provider-neutral candidate boundary rather than mixing Apify logic into the
  YouTube adapter.
- Fresh replacement and URL ownership must be scoped by platform so a TikTok
  refresh cannot replace or retire YouTube inventory.
- Deduplicate both by source URL and semantic hook similarity across platforms.
- Preserve source attribution and support removing a source that becomes
  private or unavailable.

## Alternative provider

[Bright Data's TikTok Scraper API](https://docs.brightdata.com/datasets/scrapers/tiktok/introduction)
is a reasonable enterprise fallback for discovery and structured post
metadata. It currently advertises
[US$1.50 per 1,000 delivered records](https://brightdata.com/products/web-scraper/tiktok)
and a free allowance, but its documented output does not solve transcript
retrieval. It carries the same underlying TikTok authorization question and is
not the preferred first pilot.

## Go/no-go criteria

Proceed beyond dry runs only if the pilot:

- consistently produces at least six quality-gated hooks per tested niche;
- improves relevance or hook quality over the equivalent YouTube batch;
- stays within an agreed spend cap;
- has reliable retry and provider-failure behavior; and
- has explicit owner acceptance of the documented terms risk.
