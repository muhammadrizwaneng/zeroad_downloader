# ZeroAds Downloader

Ad-free social media video and audio downloader — Phase 1 proof of concept.

## Project structure

```
zero_downloader/
├── backend/          # Node.js API (local dev)
├── backend-python/   # FastAPI API (Render production)
├── web/              # Next.js landing (Vercel)
├── mobile/           # React Native CLI app
└── DEPLOY.md         # Render + Vercel guide
```

## Prerequisites

- **Node.js** 20+ (mobile template recommends 22+)
- **yt-dlp** — one of:
  - `cd backend && bash scripts/install-ytdlp.sh` (standalone binary, no Homebrew/Python needed)
  - `brew install yt-dlp` (if Homebrew works on your machine)
- **Android Studio** or **Xcode** for running the mobile app
- **CocoaPods** for iOS — `cd mobile/ios && pod install`

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Server runs at `http://localhost:3000`.

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/extract` | Body: `{ "url": "https://..." }` → returns title, thumbnail, formats |

### 2. Mobile

```bash
cd mobile
npm install
# iOS only:
cd ios && pod install && cd ..

# Terminal 1 — Metro bundler
npm start

# Terminal 2 — run on device/emulator
npm run android
# or
npm run ios
```

### API URL for local dev

| Target | API base URL |
|--------|----------------|
| Android emulator | `http://10.0.2.2:3000` (configured automatically) |
| iOS simulator | `http://localhost:3000` |
| Physical device | Set your machine's LAN IP in `mobile/src/config.ts` |

## Share a YouTube link (Android)

1. Open a video in the **YouTube app**
2. Tap **Share**
3. Choose **ZeroAds** from the share sheet
4. The app opens, fills the URL, and starts extraction automatically

Also works for TikTok, Instagram, and other supported platforms.

## YouTube support

YouTube is fully supported via yt-dlp (1080p video, audio-only, etc.). **Do not publish YouTube downloading to Google Play** — distribute as APK/sideload per the blueprint.

## iOS share (optional setup)

Android share works out of the box. iOS requires adding a **Share Extension** in Xcode — see [react-native-receive-sharing-intent iOS docs](https://ajith-ab.github.io/react-native-receive-sharing-intent/docs/ios). Until then, paste YouTube links manually on iOS.

## Phase 1 scope

- [x] Node.js backend wrapping yt-dlp (including YouTube)
- [x] React Native URL input UI
- [x] Android share intent (YouTube Share → ZeroAds)
- [x] Format list (video/audio quality picker)
- [x] Basic download via opening CDN link
- [ ] Native DownloadManager / URLSession (Phase 2)
- [ ] Share intent integration (Phase 2)
- [ ] Background auto-resume queue (Phase 2)

## Deployment (Render + Vercel)

Full step-by-step guide: **[DEPLOY.md](./DEPLOY.md)**

| Service | Platform | Folder |
|---------|----------|--------|
| Extraction API | [Render](https://render.com) (Docker, free tier) | `backend-python/` |
| Landing + APK link | [Vercel](https://vercel.com) | `web/` |
| Android APK | GitHub Releases | build from `mobile/` |

Quick test after Render deploy:

```bash
curl https://zeroads-api.onrender.com/health
```

- **Vercel** — landing page only; yt-dlp runs on Render, not Vercel serverless.
- **Play Store** — do not ship YouTube extraction in Play Store builds; distribute full APK separately (see blueprint).

## Test the API with curl

```bash
curl -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@user/video/123"}'
```
