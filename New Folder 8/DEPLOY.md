# Deploying The Time Capsule Billboard

A live URL is **~5 minutes** away with no git, no CLI, no account setup. This file walks through every path — pure drag-and-drop, git+auto-deploy, custom domains, and alternatives — so you can pick whichever fits.

---

## My pick: Netlify

| | |
|--|--|
| **Cost** | Free tier — 100 GB bandwidth/month, 300 build minutes/month, unmetered on the static side |
| **Simplicity** | Drag a folder onto `app.netlify.com/drop` → URL in 10 seconds. No git, no install |
| **Speed** | CDN edge in 6 continents; jsDelivr-class delivery |
| **SSL** | Free Let's Encrypt on every custom domain, auto-provisioned |
| **Git** | Optional but excellent: every push auto-deploys, every PR gets a preview URL |
| **Functions** | When you wire Stripe later, `netlify/functions/` runs them in the same free tier |

---

## Path A — Drag & Drop (5 minutes, no git, no CLI)

For when you just want a URL right now and don't care about version control yet.

1. Open https://app.netlify.com/drop in a browser.
2. Sign up with email or GitHub (one click; ~30s).
3. Drag the project folder — the one containing `index.html` — onto the page.
4. Wait ~10 seconds. You'll see a live URL like:

   ```
   https://random-name-12345.netlify.app
   ```

   That's it. SSL is automatic, the URL works on HTTPS, and you can immediately share it.

### Updating later

Drag the folder again. Netlify creates a new deploy alongside the old one — you can promote the new one to "production" with one click, or roll back instantly.

---

## Path B — Git + Auto-deploy (15 minutes, recommended for ongoing work)

For version control plus continuous deployment: every `git push` rebuilds the site in ~30s, and every PR gets a preview URL on its own subdomain.

### 1. Initialize a local git repo

```bash
cd /path/to/your/project
git init
git add .
git commit -m "first commit"
```

### 2. Push to GitHub

**Easiest, using the GitHub CLI:**

```bash
gh auth login                              # one-time
gh repo create time-capsule-billboard \
  --public --source=. --remote=origin --push
```

**Or via the web UI:**

1. Create an empty repo at https://github.com/new (named `time-capsule-billboard`).
2. Then locally:

```bash
git remote add origin git@github.com:<your-username>/time-capsule-billboard.git
git push -u origin main
```

### 3. Connect to Netlify

1. Go to https://app.netlify.com.
2. Click **Add new site** → **Import an existing project**.
3. Pick **GitHub** → search for `time-capsule-billboard` → authorize Netlify.
4. Netlify reads `netlify.toml` in the repo and configures:
   - **Build command:** *(empty)*
   - **Publish directory:** `.`
   - **Branch to deploy:** `main`
5. Click **Deploy site**. The first build finishes in ~30 seconds and you have a URL.

### How ongoing pushes work

```bash
# edit a file
git add .
git commit -m "tweak copy"
git push
# → Netlify rebuilds and deploys automatically in ~30s
```

Pull requests get preview URLs at `https://deploy-preview-42--your-site.netlify.app/`.

---

## Custom domain (free, ~10 minutes if you already own the domain)

You don't need a custom domain to launch — the free `*.netlify.app` subdomain works fine. But if you want `yourname.com`:

### 1. Buy a domain

Cheapest honest registrars (~$10/yr for `.com`, no markup):

- **Cloudflare Registrar** — at-cost, no markup, simplest DNS
- **Porkbun** — competitive pricing
- **Namecheap**

### 2. Add the domain in Netlify

1. In your Netlify site → **Domain settings** → **Add a domain**.
2. Type `yourname.com` → click **Verify** → **Continue**.
3. Netlify offers two paths:

### Path X — Netlify DNS (easiest)

1. Click **Use Netlify DNS**.
2. Netlify gives you 4 nameservers (e.g. `dns1.p01.nsone.com`, `dns2.p01.nsone.com`, …).
3. At your registrar, change the **nameservers** for `yourname.com` to those four.
4. Wait 5–60 minutes for propagation.
5. Click **Verify** in Netlify. SSL auto-provisions in seconds.

### Path Y — External DNS (e.g. you already use Cloudflare DNS)

1. In Netlify, get the **CNAME** value (a subdomain like `apex-loadbalancer.netlify.com`).
2. At your DNS provider:
   - Add a **CNAME** record for `www` → `apex-loadbalancer.netlify.com`.
   - For the apex (`yourname.com`), add an **ALIAS** / **ANAME** record → `apex-loadbalancer.netlify.com` (or four **A** records to Netlify's load-balancer IPs).
3. SSL auto-provisions once DNS resolves.

### 3. Enforce HTTPS

In **Domain settings → HTTPS** → toggle **Force HTTPS** on. Free, one click, propagates in under a minute.

### Want www → apex (or apex → www) redirect?

In **Domain settings**, the **Primary domain** dropdown determines what your canonical URL is. Set the one you want as primary and add the other as a "redirects to primary" alias.

---

## Alternative: Cloudflare Pages (also excellent)

If you want **the fastest edge network on the planet** + **zero bandwidth caps**, Cloudflare Pages is the pick. Same workflow as Path B, but:

1. Sign in at https://dash.cloudflare.com.
2. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** → pick your GitHub repo.
3. **Build command:** *(empty)*
4. **Build output directory:** `/`
5. Click **Save and Deploy**.

Custom domains are configured under **Custom domains** in the Pages dashboard. SSL is automatic.

| | Netlify | Cloudflare Pages |
|--|--|--|
| Drag-and-drop deploy | ✅ Yes | ❌ No (git/CLI only) |
| Free tier bandwidth | 100 GB/mo | Unmetered |
| Edge POPs | ~15 metros | ~300 metros (faster) |
| Custom domain + SSL | 1-click, free | 1-click, free |

---

## Alternative: GitHub Pages (zero third-party signup)

If everything's already on GitHub:

1. Push the project to a repo named exactly `<your-username>.github.io`.
2. **Settings** → **Pages** → Source = `main` branch, root `/`.
3. Site appears at `https://<your-username>.github.io` within a minute.

Custom domain under **Settings → Pages → Custom domain**. SSL auto-provisions.

Note: GitHub Pages doesn't edge-cache the way Netlify/Cloudflare do — first-paint on cold visits can feel a touch slower. Fine for hobby projects.

---

## What this repo already ships with

These helper files mean deploying is literally one-click:

- **`netlify.toml`** — pins `publish = "."`, no build command, sets production security headers (X-Frame-Options, Referrer-Policy, Permissions-Policy) and a 1-year cache on the CSS/JS.
- **`_redirects`** — sends any unknown path to `404.html` with a real HTTP 404 (so Twitter/social previews don't soft-200 on broken deep-links).
- **`404.html`** — branded not-found page in the same Fraunces + JetBrains Mono typography as the home page, dark-mode-aware.
- **`robots.txt`** — allow all crawlers (`/404.html` excluded).
- **`.gitignore`** — keeps `.DS_Store`, editor files, future `node_modules/`, future `.env` secrets out of the repo.

---

## Going beyond static later

When you wire real Stripe + Supabase (see `WIRE-STRIPE.md` etc. when those guides exist), update `netlify.toml`:

```toml
[build]
  publish = "."
  command = ""
  functions = "netlify/functions"
```

Add serverless functions under `netlify/functions/stripe-webhook.js` etc. — same repo, same free tier (~125k requests/month on Netlify Functions).

If you add **environment variables** (Stripe keys, Supabase anon key), set them in **Site settings → Environment variables** in Netlify. They're injected at build time and available to functions. Add `.env.example` to the repo (without real values) so collaborators know which keys are needed.

---

## TL;DR

| You want… | Do this |
|--|--|
| A live URL in 10 minutes | Drop the folder at `app.netlify.com/drop` |
| Auto-deploy on every push | `git push` to GitHub → connect repo in Netlify |
| `yourname.com` on HTTPS | Buy domain → nameservers or CNAME to Netlify → Force HTTPS |
| Free unlimited bandwidth & fastest edge | Cloudflare Pages instead |
| Zero third-party signup | GitHub Pages |
