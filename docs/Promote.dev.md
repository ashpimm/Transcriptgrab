# Phase 1: Product & Value Discovery

Date: 2026-07-22

No production files were edited during this phase. The audit covered the active pages, routes, APIs, generation prompts, database logic, pricing gates, automation workers, documentation, and automated tests. All 91 tests passed.

## What the product actually does

The product currently called Hooklab is a faceless social-content engine for app and SaaS founders. It is not the transcript downloader described in the old README, and it is no longer the script-pack product described in the current `PRODUCT.md`.

Its core workflow is:

1. The user pastes an App Store, Play Store, SaaS, or product-page URL.
2. The product reads the page and builds a reusable profile containing the product, target customer, key benefit, verified facts, brand color, and the audience's content niche.
3. It researches recent YouTube Shorts and admits only hooks meeting specific evidence thresholds:
   - At least 5x as many views as the creator has followers
   - At least 10,000 views
   - At least 50 followers
   - Published within roughly 120 days
   - A usable spoken transcript and niche relevance
4. AI selects a hook that can genuinely transfer to the product, preserves its winning structure, and rewrites it for the product's buyers.
5. It generates a complete six-slide, faceless carousel:
   - Coherent hook-to-payoff narrative
   - Designed 1080x1350 slides
   - Photographic cover and supporting visuals
   - Product-brand accent color
   - CTA, caption, and hashtags
6. Users can download the complete post as a ZIP, copy the caption, regenerate the visuals, or choose a different hook and style.
7. Pro users can also create a silent 1080x1920 Reel and, when auto-posting is enabled, connect social accounts for daily scheduled publishing with queue and delivery-status tracking.

There is also a public, filterable hook feed with source videos, view/follower receipts, outlier scores, and a saved-hook collection.

### Current commercial model

- Free: three lifetime carousels with a subtle last-slide watermark
- Pro: $19/month, 30 carousels per month, no watermark, Reel export, and auto-posting access
- Social auto-posting is implemented behind a feature flag; the customer UI currently describes it as an Instagram private beta. The backend can technically target Instagram and TikTok.

## Primary audience

The strongest primary audience is solo app founders, indie hackers, and small SaaS teams who can build products but struggle to consistently market them through short-form social content.

A secondary audience could be lean agencies or product marketers managing app-based clients, but the present experience is unmistakably founder-first: paste your app, no camera, no followers, and minimal marketing expertise required.

This is not currently a general creator tool. It produces audience-building content around a product and its buyers, not personal-brand scripts built around a creator's expertise.

## Primary pain point

The underlying pain is larger than needing carousel designs.

These customers can ship software, but reaching buyers requires a second, unfamiliar job:

- Researching what is performing
- Finding credible hooks
- Turning product features into interesting content
- Writing a full narrative rather than an advertisement
- Designing every asset
- Filming or editing video
- Posting consistently

The product compresses that fragmented marketing workflow into one product URL and one generation action.

The emotional job is to remove the blank-page anxiety and uncertainty that stops builders from marketing what they made.

The practical job is to turn product information into publishable social content without research, filming, design, or copywriting work.

## The buried unfair advantage

The real differentiator is not AI carousels. That category is easy to copy and currently dominates too much of the surface positioning.

The defensible value is the combination of evidence-backed creative research with buyer-niche adaptation.

Most AI content tools start from a prompt and generate plausible ideas. This product starts from opening patterns that demonstrably outperformed their originating accounts, shows the receipts, determines what the product's actual buyers watch, and then transfers the proven structure into a finished post.

That supports a much stronger promise:

> Go from guessing what to post to publishing complete, faceless content built from patterns already earning disproportionate attention in your buyers' niche.

The especially valuable, under-communicated part is the audience-niche engine. A calorie app does not receive indie-hacker content just because its founder is a developer; it receives fitness and weight-loss content because that is what its buyers consume. This is a meaningful advantage over generic app-marketing generators.

One positioning constraint should remain explicit: the product proves that the source opening earned attention, not that the generated adaptation will produce conversions or guaranteed views. "Proven hook structure" is credible; "proven post performance" would overstate the implementation.

## Important source-of-truth discrepancy

Two prominent project documents are materially outdated:

- `README.md` still describes the original YouTube transcript downloader.
- `PRODUCT.md` still describes $39/month script packs and a broader creator/agency product.

The shipped application is the newer $19/month app-marketing carousel, Reel, and automation product described above.

