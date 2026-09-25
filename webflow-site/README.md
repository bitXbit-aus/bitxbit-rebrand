# bitXbit Marketing Site

Static marketing site for the bitXbit rebrand. Built as plain HTML/CSS/JS for maximum portability and hosted on **Netlify**.

---

## Files

```
webflow-site/
├── index.html                  # Homepage
├── how-it-works.html           # 5-step flow explanation
├── referrals.html              # Affiliate hub with filterable cards
├── token-economy.html          # Allocation model + token info
├── projects.html               # Funded projects showcase
├── transparency.html           # Public ledger
├── faq.html                    # Accordion FAQ
├── legal-disclaimer.html       # All legal pages in one (anchor-linked)
├── style-guide.html            # Visual component reference
├── css/
│   └── design-system.css       # Complete design system
├── js/
│   └── main.js                 # Interactions & utilities
├── netlify.toml                # Netlify config (headers, redirects, processing)
├── _redirects                  # Pretty URL redirects
├── package.json                # Dev dependencies for local preview
└── README.md                   # This file
```

---

## Local Development

No build step required. Serve the folder with any static server:

```bash
cd webflow-site
npx serve .
# or
python3 -m http.server 8000
# or
netlify dev
```

---

## Deploy to Netlify

### Option A: Drag & Drop (Quickest)

1. Zip the contents of `webflow-site/` (not the folder itself).
2. Go to [Netlify Drop](https://app.netlify.com/drop).
3. Drag the zip onto the drop zone.
4. Your site is live instantly.

### Option B: Git-Based Deploy (Recommended)

1. Push `webflow-site/` to a GitHub/GitLab/Bitbucket repository.
2. In Netlify dashboard: **Add new site** → **Import an existing project**.
3. Connect your Git provider and select the repo.
4. Build settings:
   - **Build command:** `echo 'Static site — no build step required'`
   - **Publish directory:** `/` (or `webflow-site/` if the folder is inside the repo root)
5. Click **Deploy**.

### Option C: Netlify CLI

```bash
# Install CLI globally
npm install -g netlify-cli

# Login
cd webflow-site
netlify login

# Link to a site (or create new)
netlify link
# or
netlify sites:create --name bitxbit-marketing

# Deploy
netlify deploy --prod
```

---

## Netlify Configuration

### `netlify.toml`

- **Pretty URLs** enabled: `/how-it-works.html` → `/how-it-works`
- **CSS/JS bundling & minification** enabled
- **Image compression** enabled
- **Security headers** applied globally:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Content-Security-Policy` (restrictive default)
  - `Strict-Transport-Security` (HSTS)
- **Asset caching**: CSS/JS cached for 1 year

### `_redirects`

Explicit 200 rewrites for clean URLs:

| Clean URL | Serves |
|-----------|--------|
| `/how-it-works` | `how-it-works.html` |
| `/referrals` | `referrals.html` |
| `/token-economy` | `token-economy.html` |
| `/projects` | `projects.html` |
| `/transparency` | `transparency.html` |
| `/faq` | `faq.html` |
| `/legal` | `legal-disclaimer.html` |
| `/style-guide` | `style-guide.html` |

---

## Custom Domain

1. In Netlify dashboard: **Domain settings** → **Add custom domain**.
2. Enter `bitxbit.com.au`.
3. Update DNS records at your registrar to point to Netlify:
   - **A record:** `@` → `75.2.60.5`
   - **CNAME record:** `www` → `[your-site-name].netlify.app`
4. Enable **HTTPS** — Netlify provisions a free Let's Encrypt certificate automatically.

---

## Environment-Specific Links

The site references the dashboard at `https://app.bitxbit.com.au`. Before going live:

1. Update all `app.bitxbit.com.au` links in HTML files to your actual dashboard URL.
2. If the dashboard is also on Netlify (e.g., `bitxbit-dashboard.netlify.app`), update accordingly.

---

## Post-Deploy Checklist

- [ ] Custom domain connected and HTTPS active
- [ ] Pretty URLs working (`/faq` loads without `.html`)
- [ ] Security headers verified (check at [securityheaders.com](https://securityheaders.com))
- [ ] Mobile responsive tested
- [ ] All internal navigation links working
- [ ] Dashboard link updated to production URL
- [ ] Affiliate disclosure visible on referrals page
- [ ] Legal disclaimer page accessible from footer
- [ ] Form submissions (if any) connected to Netlify Forms or external service

---

## Updating Content

Because this is a static site, content updates require editing the HTML files and redeploying:

1. Edit the relevant `.html` file.
2. Commit and push (if using Git deploy), or re-drag the folder to Netlify Drop.
3. Netlify deploys the update instantly.

For dynamic content (affiliate offers, projects, transparency reports), consider:
- **Netlify CMS** (Decap CMS) for Git-based content management
- **Supabase** + small JS snippet to fetch dynamic data client-side
- **Webflow** for the marketing site and this static site for overflow pages

---

## Compliance Notes

This site includes:
- Affiliate disclosure on referral cards and footer
- Token reward disclaimers (no guaranteed returns)
- "Not financial advice" statements
- Crypto risk warnings in legal section
- Australia-focused legal framing

Before publishing, review `legal-disclaimer.html` with a lawyer to ensure full compliance with Australian law (ASIC, ACCC, AUSTRAC as applicable).

---

## Support

For the full strategic blueprint, dashboard specs, and design system details:
`/Users/bitxbit/projects/bitxbit-rebrand/REBRAND-BLUEPRINT-v2.md`
