# Hooklab 🎬

A YouTube transcript downloader that works on **every video** — even ones without captions.

- **Free tier**: Single video + ad countdown
- **Pro tier ($4.99)**: Bulk download up to 50 videos, no ads

**Total cost to build & deploy: $0**

---

## How It Works

```
User pastes YouTube URL
        │
        ▼
┌─ Step 1: Check YouTube Captions ──────┐
│  (free, instant, covers ~90% of vids) │
│  Found? → Return transcript           │
└───────────┬───────────────────────────┘
            │ No captions?
            ▼
┌─ Step 2: AI Speech-to-Text Fallback ──┐
│  Extract audio URL from YouTube        │
│  Send to AssemblyAI for transcription  │
│  Frontend polls until done (30-90s)    │
│  Return transcript                     │
└────────────────────────────────────────┘
```

---

## Stack (all free tiers)

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| **Vercel** | Hosting + serverless API | 100k requests/month |
| **AssemblyAI** | Speech-to-text fallback | $50 credit (~333 hours) |
| **Stripe** | Bulk purchase payments | No monthly fee (2.9% + $0.30 per txn) |
| **Google AdSense** | Revenue from free users | Free |

---

## 🚀 Quick Start

### 1. Create Free Accounts
- [Vercel](https://vercel.com) · [AssemblyAI](https://www.assemblyai.com) · [Stripe](https://stripe.com) · [AdSense](https://adsense.google.com)

### 2. Deploy
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/YOU/hooklab.git
git push -u origin main
```
Then import into Vercel. Add env var `ASSEMBLYAI_API_KEY` with your key.

### 3. Configure
In `index.html`, update the CONFIG object with your Vercel URL and Stripe Payment Link.

### 4. Add AdSense
Replace the ad placeholder in `index.html` with your AdSense code once approved.

---

## 📁 Files

```
├── index.html          # Frontend (single file)
├── api/
│   ├── transcript.js   # Main: captions → AssemblyAI fallback
│   └── poll.js         # Polls long-running transcriptions
├── vercel.json
└── package.json
```

---

## 💰 Revenue vs Costs

AssemblyAI's $50 credit covers ~333 hours. Since ~90% of videos have captions (free), only ~10% need STT. One $4.99 bulk purchase covers ~33 hours of STT.

---

## ⚠️ Vercel Free Tier Note

Free tier has a 10s function timeout, but the polling approach works around this. The initial `/api/transcript` request starts the AssemblyAI job and returns a `transcriptId`. The frontend then polls `/api/poll` (each call is <1s). No Pro plan needed.

---

## License

MIT
