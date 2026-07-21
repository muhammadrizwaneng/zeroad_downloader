# Deploy ZeroAds (Render + Vercel)

Deploy the **Python API** on Render and the **landing page** on Vercel. The mobile app talks to Render; the website hosts the APK download link.

## Architecture

| Component | Host | Folder | URL |
|-----------|------|--------|-----|
| Extraction API | **Render** (Docker) | `backend-python/` | `https://zeroads-api.onrender.com` |
| Download landing page | **Vercel** (Next.js) | `web/` | `https://your-app.vercel.app` |
| Android APK | **GitHub Releases** | `mobile/android` build | Linked from Vercel env var |

---

## 1. Push code to GitHub

Repo: `https://github.com/muhammadrizwaneng/zeroad_downloader`

```bash
git add .
git commit -m "Prepare Render and Vercel deployment"
git push origin main
```

---

## 2. Deploy API on Render

1. Go to [render.com](https://render.com) → **Sign in** (GitHub).
2. **New +** → **Web Service** (or **Blueprint** if you want `render.yaml` at repo root).
3. Connect **`zeroad_downloader`** repository.
4. Settings:

   | Setting | Value |
   |---------|--------|
   | **Name** | `zeroads-api` |
   | **Root Directory** | `backend-python` |
   | **Runtime** | **Docker** |
   | **Instance type** | Free |

5. **Environment variables**:

   | Key | Value |
   |-----|--------|
   | `CORS_ORIGIN` | `*` |
   | `PUBLIC_API_URL` | `https://zeroads-api.onrender.com` (use your actual Render URL after create) |

6. Click **Create Web Service**. First build takes ~5–10 minutes.

7. Test when live:

   ```bash
   curl https://zeroads-api.onrender.com/health
   ```

   ```bash
   curl -X POST https://zeroads-api.onrender.com/api/extract \
     -H "Content-Type: application/json" \
     -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
   ```

**Note:** Free tier sleeps after ~15 min idle. First request after sleep can take **~1 minute** (cold start).

---

## 3. Deploy website on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**.
2. Import **`zeroad_downloader`** from GitHub.
3. Settings:

   | Setting | Value |
   |---------|--------|
   | **Root Directory** | `web` |
   | **Framework** | Next.js (auto-detected) |

4. **Environment variables** (optional until APK is ready):

   | Key | Value |
   |-----|--------|
   | `NEXT_PUBLIC_APK_URL` | GitHub Release APK URL (step 4) |

5. **Deploy**.

Your site will be at `https://zeroad-downloader.vercel.app` (or similar).

---

## 4. Publish Android APK (GitHub Releases)

1. Update production API in `mobile/src/config.ts`:

   ```ts
   : 'https://zeroads-api.onrender.com';  // your Render URL
   ```

2. Build release APK:

   ```bash
   cd mobile/android
   ./gradlew assembleRelease
   ```

   Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`

3. On GitHub → **Releases** → **Create a new release**:
   - Tag: `v1.0.0`
   - Upload `app-release.apk` (rename to `ZeroAds.apk` if you prefer)

4. Copy the asset URL, e.g.:

   ```
   https://github.com/muhammadrizwaneng/zeroad_downloader/releases/download/v1.0.0/ZeroAds.apk
   ```

5. In **Vercel** → Project → **Settings → Environment Variables**:
   - `NEXT_PUBLIC_APK_URL` = that URL
   - **Redeploy** the web project.

---

## 5. Point mobile app at production API

In `mobile/src/config.ts`, set the production URL to your Render service:

```ts
export const API_BASE_URL = __DEV__
  ? `http://${DEV_API_HOST}:3000`
  : 'https://zeroads-api.onrender.com';
```

Rebuild and install the APK on a device.

---

## CLI shortcuts (optional)

### Vercel (from `web/`)

```bash
cd web
npx vercel --prod
# Set NEXT_PUBLIC_APK_URL in Vercel dashboard or:
npx vercel env add NEXT_PUBLIC_APK_URL production
```

### Render

Use the dashboard (recommended). Render CLI is optional; Blueprint uses repo root `render.yaml`.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Extract timeout on Render | Cold start — wait 60s and retry; upgrade plan or use a keep-alive ping |
| Merge download fails | Dockerfile includes `ffmpeg`; check Render logs |
| Mobile can't reach API | Use Render **HTTPS** URL in `config.ts`, not `localhost` |
| APK button missing on site | Set `NEXT_PUBLIC_APK_URL` in Vercel and redeploy |
| CORS errors | Set `CORS_ORIGIN=*` or your Vercel domain on Render |
| YouTube “Sign in to confirm you're not a bot” | Redeploy Render (Docker now includes PO token provider). Cookies optional. |

---

## 5. YouTube on Render (automatic fix)

The Docker image now runs a **PO token provider** (`bgutil`) alongside the API. This bypasses YouTube bot checks on datacenter IPs — **no cookies required** for most cases.

**You must push the latest code and redeploy Render:**

```bash
git add backend-python/
git commit -m "Add YouTube PO token provider for Render"
git push
```

Then in Render → **Manual Deploy** → Deploy latest commit.

Wait for the build to finish (first build may take ~5–10 min — installs Node + bgutil).

Test:

```bash
curl -X POST https://zeroads-api.onrender.com/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/shorts/F6Yqq2FEn70"}'
```

### Optional: cookies as backup

If YouTube still fails after redeploy, add `YTDLP_COOKIES` (see old steps below). Usually not needed once PO provider is running.

<details>
<summary>Manual cookie export (backup only)</summary>

1. Install **Get cookies.txt LOCALLY** in normal Chrome → enable **Allow in incognito**
2. Incognito → sign in to YouTube (2nd Gmail) → export cookies → close incognito
3. Render → Environment → `YTDLP_COOKIES` = full file contents → redeploy

</details>

---

## 6. Alternative: run backend from home (Cloudflare Tunnel)

If Render still fails, run the API on your Mac (residential IP — YouTube works without cookies):

```bash
# Terminal 1 — API
cd backend-python
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

# Terminal 2 — public HTTPS URL (install: brew install cloudflared)
cloudflared tunnel --url http://localhost:8000
```

Copy the `https://xxxx.trycloudflare.com` URL into `mobile/src/config.ts`:

```typescript
const PRODUCTION_API_URL = 'https://xxxx.trycloudflare.com';
```

Rebuild the APK. Downside: your Mac must stay on; URL changes each time unless you set up a named tunnel.
