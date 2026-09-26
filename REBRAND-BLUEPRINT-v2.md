# bitXbit Complete Rebrand Blueprint v2
## Based on Live Site Audit + Strategic Redesign Plan

---

## 1. LIVE SITE AUDIT — CURRENT STATE OF BITXBIT.COM.AU

### Technical Stack (Confirmed)
- **Platform:** Webflow (confirmed via `cdn.prod.website-files.com` asset URLs)
- **Hosting:** Webflow CDN with AWS edge infrastructure
- **Domain:** bitxbit.com.au → 301 redirect → www.bitxbit.com.au
- **Site type:** Single-page marketing site (no CMS collections detected in public crawl)
- **Last published:** Wed, 20 May 2026 21:23:25 GMT

### Current Content Architecture
The site is a **single landing page** with the following sections:

1. **Hero:** "BITXBIT - Building your Wealth" + AI-generated hero image (OIG(32).jpg)
2. **Tagline:** "Deployed on the fastest, cheapest, carbon neutral blockchain" + Built on Solana badge
3. **OG Story:** "Originally released for testing applications built upon the Solana blockchain. bitXbit has grown into a community MEME coin. (Manifesting Energetic Miracle Exchanges)"
4. **Supply:** Max total supply — 1 million
5. **DeGen Positioning:** "bitXbit will continue to remain a genuine DeGen token residing only on-chain creating crypto abundance for HODLers and humanity"
6. **Airdrop:** "The bitXbit airdrop is ongoing to fellow users of our favorite applications on Solana"
7. **Partner Logos:** WEN, JUP, HXRO, BONK, PYTH, USDC, ORCA
8. **Get bitXbit:** Exchange links to Jupiter, Meteora, Raydium, Birdeye, Orca
9. **Liquidity:** Pool links for BITXBIT/USDC (Meteora), BITXBIT/SOL (Raydium), BITXBIT/USDC (Orca)

### Token Details (On-Chain Facts)
- **Blockchain:** Solana
- **Contract Address:** `DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5`
- **Max Supply:** 1,000,000 tokens
- **Current Exchanges:** Jupiter, Meteora, Raydium, Birdeye, Orca
- **Active Pools:**
  - BITXBIT/USDC on Meteora
  - BITXBIT/SOL on Raydium
  - BITXBIT/USDC on Orca

### Critical Compliance Issues Identified
| Issue | Current Language | Risk Level |
|-------|-----------------|------------|
| Investment framing | "Building your Wealth" / "Build your Wealth" | **HIGH** |
| Security-like language | "creating crypto abundance for HODLers" | **HIGH** |
| Meme/degen positioning | "genuine DeGen token" / "MEME coin" | **HIGH** |
| Guaranteed outcome implication | "Manifesting Energetic Miracle Exchanges" | **MEDIUM** |
| No disclaimers | Zero legal, risk, or affiliate disclosure | **HIGH** |
| No privacy policy | Not detectable | **HIGH** |
| No terms of use | Not detectable | **HIGH** |
| Yield/farming suggestion | "Support our mission and earn yield by depositing" | **MEDIUM** |

### What's Missing (Opportunity Assessment)
- ❌ No affiliate or referral hub
- ❌ No member dashboard
- ❌ No transparency ledger
- ❌ No project funding page (New Earth Healing Clinic not mentioned)
- ❌ No FAQ
- ❌ No legal pages whatsoever
- ❌ No token economy explanation
- ❌ No "how it works" flow
- ❌ No community participation mechanics
- ❌ No email capture or membership system
- ❌ Single page only — no information architecture

### Audit Conclusion
The current site is a **classic single-page meme token landing page** with significant compliance exposure. It frames the token as a wealth-building vehicle for "HODLers," uses degen/meme culture language, and contains zero legal protections. 

**The gap between current state and desired state is total.** This is not an incremental redesign — it is a complete repositioning, re-architecture, and compliance overhaul.

---

## 2. STRATEGIC REBRAND PLAN

### The Pivot Summary
| Dimension | Current State | Desired State |
|-----------|--------------|---------------|
| Identity | Solana meme/degen coin | Referral-powered circular economy |
| Primary message | "Build your wealth" | "Turn everyday referrals into shared digital abundance" |
| Target audience | Crypto speculators / degen traders | Conscious community members, referral participants |
| Token framing | Investment/HODL vehicle | Ecosystem participation credit |
| Revenue model | None visible | Affiliate/referral income aggregation |
| Compliance | None | Full disclaimer framework (AU-aligned) |
| Site scope | Single page | 9+ page ecosystem with dashboard |

### Core Brand Narrative
> "bitXbit is a circular economy. Everyday referrals generate real income. That income builds token liquidity, funds buybacks, rewards community participants, and supports regenerative real-world projects — including the New Earth Healing Clinic. You don't buy in. You participate."

### Messaging Hierarchy (Every Page Must Answer)
1. **What:** We curate trusted referral and affiliate links.
2. **How:** When you use them, income flows into the ecosystem.
3. **Where it goes:** Rewards, liquidity, buybacks, projects, operations.
4. **What you get:** A share back in bitXbit ecosystem credits.
5. **What it is NOT:** An investment, security, or guaranteed income product.

### Solana Integration Note
Because the token is already live on Solana, the new site must:
- Continue supporting Solana wallet connections (Phantom, Solflare, Backpack, etc.)
- Maintain existing exchange/liquidity pool links (these are factual, on-chain infrastructure)
- Potentially use Solana for on-chain reward distribution in future phases
- Reference the token contract address transparently

### Compliance Framework (Australia-First)
- **ASIC guidance:** No misleading/deceptive conduct. No unlicensed financial product promotion.
- **ACCC affiliate rules:** Clear disclosure on every referral link.
- **Token framing:** Community credit / loyalty incentive / ecosystem participation reward.
- **No language of:** profit, yield (except factual DeFi pool links with disclaimers), passive income, ROI, APY, guaranteed returns, investment.
- **Required pages:** Privacy Policy, Terms of Use, Affiliate Disclosure, Risk Warning.

---

## 3. REVISED SITEMAP

```
bitxbit.com.au
|
|-- / (Home)
|   |-- Hero + 5-step flow preview + live metrics + featured referrals + project preview
|
|-- /how-it-works
|   |-- 5-step visual flow + detailed explanation + compliance disclaimers
|
|-- /referrals (Affiliate Hub)
|   |-- Filterable card grid
|   |-- /category/:slug (filtered views)
|
|-- /token-economy
|   |-- What bitxbit is + allocation model + transparency principles + future utility
|
|-- /projects
|   |-- New Earth Healing Clinic + liquidity + buybacks + future initiatives
|
|-- /transparency
|   |-- Monthly ledger + allocation proof + downloadable reports
|
|-- /faq
|   |-- Categorized questions (General, Token, Rewards, Legal, Safety)
|
|-- /dashboard (Authenticated Member Portal)
|   |-- /overview (default)
|   |-- /profile
|   |-- /rewards
|   |-- /activity
|   |-- /wallet
|   |-- /transparency (read-only)
|
|-- /legal
|   |-- /disclaimer (token + affiliate + no financial advice)
|   |-- /privacy (AU Privacy Principles aligned)
|   |-- /terms (eligibility, jurisdiction, conduct)
|   |-- /affiliate-disclosure (ASIC/ACCC compliant)
|   |-- /crypto-risk (volatility, loss risk, not a bank)
|
|-- /admin (Role-Gated Admin Portal) → app.bitxbit.com.au/admin
|   |-- /offers
|   |-- /income
|   |-- /allocations
|   |-- /rewards
|   |-- /users
|   |-- /reports
|   |-- /transparency-updates
|   |-- /projects
```

---

## 4. HOMEPAGE ARCHITECTURE & COPY

### Navigation
- **Logo:** bitXbit (lowercase b, capital X, lowercase bit — retain existing wordmark feel)
- **Links:** How It Works | Referrals | Token Economy | Projects | Transparency | FAQ
- **CTAs:** "View Dashboard" (primary navy/gold button) | "Explore Referrals" (secondary)
- **Mobile:** Hamburger with identical links + CTAs

---

### SECTION 1: HERO

**Background:** Deep navy (#0A0E1A) with subtle animated particle loop in electric blue (#3B82F6) and gold (#F59E0B). Soft radial gradient emanating from center.

**Headline:**
"Turn everyday referrals into shared digital abundance."

**Subheadline:**
"bitXbit brings trusted referral and affiliate opportunities into one ecosystem, using generated income to support token rewards, liquidity, buybacks, and regenerative real-world projects."

**Primary CTA:** "Explore Referrals" → /referrals
**Secondary CTA:** "How It Works" → /how-it-works
**Tertiary CTA:** "View Dashboard" → /dashboard

**Trust bar (below fold):**
"✓ Transparent  ✓ Community-powered  ✓ Regenerative  ✓ Solana-native"

---

### SECTION 2: THE CIRCLE (5-Step Preview)

**Heading:** "Click by click, bit by bit."
**Subheading:** "See how everyday digital activity becomes shared abundance."

Horizontal 5-step flow (vertical on mobile):

1. **Join** — Create your free account. No purchase required.
2. **Explore** — Browse trusted referrals across crypto, wellness, AI, and more.
3. **Use** — Click links for products and services you actually need.
4. **Flow** — Generated income funds rewards, liquidity, buybacks, and projects.
5. **Share** — A percentage returns to you as bitXbit ecosystem credits.

**Link:** "See the full flow →" → /how-it-works

---

### SECTION 3: LIVE ECOSYSTEM PULSE

**Heading:** "Ecosystem Pulse"
**Subheading:** "Real numbers. Real flow. Updated regularly."

4 stat cards:
- **Liquidity Built** — $X,XXX | "Supporting healthy markets"
- **Tokens Bought Back** — XXX,XXX bitxbit | "Community-supported stability"
- **Projects Funded** — X | "Starting with the New Earth Healing Clinic"
- **Community Members** — X,XXX | "And growing"

**Link:** "View full transparency ledger →" → /transparency

---

### SECTION 4: FEATURED REFERRALS

**Heading:** "Trusted Opportunities"
**Subheading:** "Tools and services we use ourselves."

3-6 curated cards (pulled from Webflow CMS):
- Category tag
- Logo + name
- One-line benefit
- CTA: "Get Started"

**Link:** "Explore all opportunities →" → /referrals

---

### SECTION 5: PROJECTS PREVIEW

**Heading:** "Real-World Impact"
**Subheading:** "Where ecosystem flow meets physical regeneration."

Featured project card:
- **New Earth Healing Clinic**
- Description: "A regenerative healing centre offering holistic therapies and accessible community wellness programs."
- Funding goal: $50,000 AUD
- Progress bar: XX%
- Impact statement: "Every referral helps fund accessible healing."

**Link:** "See all projects →" → /projects

---

### SECTION 6: FINAL CTA

**Heading:** "Start participating today."
**Subheading:** "No investment. No hype. Just participation."

**Buttons:**
- "Explore Referrals" (primary)
- "View Dashboard" (secondary)

---

### FOOTER

**Column 1 — Navigate:**
Home, How It Works, Referrals, Token Economy, Projects, Transparency, FAQ

**Column 2 — Legal:**
Disclaimer, Privacy Policy, Terms of Use, Affiliate Disclosure, Crypto Risk Warning

**Column 3 — Connect:**
[Social links], Contact

**Bottom bar:**
"© 2025 bitXbit. A community ecosystem, not an investment product. All rights reserved."

---

## 5. COMPLETE COPY DRAFTS FOR ALL MAJOR PAGES

---

### PAGE: /how-it-works

**H1:** How bitXbit Works
**Subhead:** A circular economy powered by everyday referrals.

**Introduction paragraph:**
bitXbit is simple: we gather trusted referral and affiliate links in one place. When you use those links to sign up for products and services you actually need, the partner pays us a referral fee. That fee doesn't go to shareholders — it flows back into the ecosystem. Here's how:

**Step 1: Join the Ecosystem**
Create your free bitXbit account. Connect your Solana wallet if you want to receive bitxbit ecosystem credits. No purchase is required to participate. Eligibility depends on your local laws — you must be 18 or older.

**Step 2: Explore Trusted Opportunities**
Browse curated referral links across categories: crypto exchanges, wallets, financial tools, AI platforms, wellness, education, business tools, and regenerative living. Every offer is vetted.

**Step 3: Use Links That Serve You**
Click through and sign up or purchase only when it genuinely makes sense for you. There's no pressure, no minimums, and no obligation. When a qualifying action happens, affiliate income is generated.

**Step 4: Income Circulates**
Generated revenue is allocated according to our published model: community rewards, liquidity creation, token buybacks, project funding, and operations.

**Step 5: Shared Abundance**
A percentage of affiliate income is distributed back to active participants as bitXbit ecosystem credits (bitxbit), according to the published allocation model and your activity level.

**Visual:** Circular flow diagram. Income enters at top, splits into 5 streams, flows back to community.

**Bottom CTA:** "Explore Referrals" | "View Dashboard"

**Disclaimer block (required):**
"bitXbit tokens are community participation incentives, not financial products, securities, or guaranteed income. Rewards depend on actual affiliate revenue generated and are subject to the published allocation model. Past activity does not guarantee future rewards. Nothing on this page is financial advice."

---

### PAGE: /referrals (Affiliate Hub)

**H1:** Referral & Affiliate Hub
**Subhead:** Trusted tools, services, and platforms. Every click supports the circular economy.

**Filter bar:** All | Crypto | Wallets | Finance | AI | Wellness | Education | Business | Regenerative Living | Technology

**Card template:**
- [Category tag — small pill]
- [Logo / icon]
- **Product Name**
- Short description (1 sentence)
- "Benefit to you: [e.g., 'Get $20 in BTC on signup']"
- [Button: "Get Started" — links to referral URL]
- *Small text: "bitXbit may receive affiliate income from this partner. This supports the ecosystem."*
- *[Optional badge: "Eligible for bitxbit Rewards"]*

**Sample cards (populate via CMS):**

**Binance**
- Category: Crypto Exchange
- Description: The world's largest crypto exchange by trading volume.
- Benefit: Reduced trading fees for new users.
- Disclosure: bitXbit may earn affiliate income.

**Phantom**
- Category: Wallet
- Description: The friendly Solana wallet trusted by millions.
- Benefit: Free to use. Secure self-custody.
- Disclosure: bitXbit may earn affiliate income.

**Jupiter**
- Category: DeFi
- Description: Solana's leading decentralised exchange aggregator.
- Benefit: Best swap rates across Solana.
- Disclosure: bitXbit may earn affiliate income.

**Bottom section:**
"Have a referral opportunity we should feature? [Contact us]"

**Disclaimer:**
"Links on this page are affiliate links. bitXbit may receive compensation when you sign up or purchase through these links, at no extra cost to you. This income supports the bitXbit ecosystem, including community rewards, liquidity, buybacks, and project funding."

---

### PAGE: /token-economy

**H1:** The bitXbit Token Economy
**Subhead:** How affiliate income flows back to the community.

**Section 1: What is the bitXbit Token?**

The bitXbit token (bitxbit) is an ecosystem participation credit issued on the Solana blockchain. It is not a security, share, investment product, or guaranteed income source.

**Contract Address:** `DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5`
**Blockchain:** Solana
**Max Supply:** 1,000,000 bitxbit

Current uses within the ecosystem:
- Recognising community participation and contribution
- Tracking engagement within the referral ecosystem
- Accessing future utility features as they are developed

**Section 2: Where Affiliate Income Goes**

Visual: Interactive donut chart with editable placeholder percentages.

| Allocation | Percentage | Purpose |
|------------|-----------|---------|
| Community Token Rewards | 40% | Distributed to participants as bitxbit ecosystem credits |
| Liquidity Creation | 25% | Building and sustaining token liquidity pools |
| Token Buybacks | 15% | Supporting market stability by purchasing circulating supply |
| Project Funding | 10% | Directly funding regenerative and healing initiatives |
| Operations & Growth | 10% | Platform maintenance, development, and community building |

*Note: These percentages are placeholder figures subject to confirmation, community review, and may be adjusted periodically. All changes will be published in the Transparency Ledger.*

**Section 3: Transparency Principles**
- All allocations are published monthly in the Transparency Ledger.
- Proof of affiliate income (where permissible) is uploaded.
- No guaranteed returns. Reward amounts depend entirely on actual affiliate income.
- The allocation model may evolve. Changes are pre-announced.
- bitXbit does not control token price. Buybacks are a support mechanism, not a price floor.

**Section 4: Existing Liquidity Pools (Factual Infrastructure)**
The following liquidity pools exist as on-chain infrastructure. Providing liquidity carries risk, including impermanent loss. Do your own research.
- BITXBIT/USDC on Meteora
- BITXBIT/SOL on Raydium
- BITXBIT/USDC on Orca

**Section 5: Future Utility (Not Guaranteed)**
Potential future uses for bitxbit, subject to development and community input:
- Governance voting on project funding priorities
- Premium dashboard features or early access
- Exclusive partner discounts
- Enhanced reward multipliers for long-term participants

**Disclaimer block:**
"bitxbit is a community ecosystem credit, not a financial product. Nothing herein constitutes an offer to sell, solicitation to buy, or recommendation for any security or investment. Cryptocurrency markets are volatile. You may lose all value. Always do your own research."

---

### PAGE: /projects

**H1:** Projects Funded by the Ecosystem
**Subhead:** Real-world impact, powered by referral clicks.

**Introduction:**
A percentage of every dollar generated through the bitXbit referral ecosystem goes directly to projects that regenerate people, communities, and the planet. This is not charity — it is circular economy design.

**Featured Project: New Earth Healing Clinic**
- Status: Active — Accepting ecosystem funding
- Description: A regenerative healing centre offering holistic therapies, community wellness programs, and accessible health services for underserved populations.
- Funding Goal: $50,000 AUD
- Amount Allocated to Date: $X,XXX
- Progress bar: [XX%]
- Impact Statement: "Every referral click helps fund accessible healing for people who need it most."

**Infrastructure Projects:**

**Token Liquidity Building**
- Status: Ongoing
- Description: Sustained allocation to liquidity pools ensures smoother trading and market depth for bitxbit.
- This is infrastructure, not an investment recommendation.

**Token Buyback Reserve**
- Status: Active
- Description: A portion of affiliate income is used to purchase bitxbit from the open market. This is a community-supported stability mechanism, not a price guarantee.

**Future Initiatives (In Planning):**
- Community regenerative education fund
- Local food security projects
- Wellness accessibility grants

**Disclaimer:** "Project funding depends on actual affiliate income. Goals are targets, not guarantees. bitXbit does not solicit donations — funding comes from ecosystem revenue only."

---

### PAGE: /transparency

**H1:** Transparency Ledger
**Subhead:** Open books. Verified flows. Monthly reports.

**Introduction:**
We believe trust is built through transparency. Every month, we publish how much affiliate income was generated and exactly how it was allocated. This page is public — no login required.

**Latest Report (Template):**

| Month | Total Affiliate Income | Rewards Allocated | Liquidity Allocated | Buybacks Allocated | Projects Allocated | Proof |
|-------|----------------------|-------------------|---------------------|-------------------|-------------------|-------|
| May 2025 | $X,XXX | $XXX (40%) | $XXX (25%) | $XXX (15%) | $XXX (10%) | [View Proof] |

**Visual:** Stacked bar chart showing monthly allocation breakdown.

**Archive:**
Filter by: Year | Month | Category
Download: PDF Report | CSV Data

**Proof Standards:**
- Affiliate network screenshots or statements (redacted where necessary)
- On-chain transaction hashes for buybacks and liquidity additions
- Project funding receipts or transfer confirmations
- All proof linked or embedded per monthly report

**Bottom:** "Questions about the ledger? Visit the FAQ or contact us."

---

### PAGE: /faq

**H1:** Frequently Asked Questions

**General**

**Q: What is bitXbit?**
A: bitXbit is a community ecosystem that gathers referral and affiliate opportunities under one brand. When you use our links to sign up for products and services, generated income supports token rewards, liquidity, buybacks, and regenerative real-world projects like the New Earth Healing Clinic.

**Q: How does bitXbit earn affiliate income?**
A: We partner with companies that offer referral programs. When you click a link on our site and complete a qualifying action (like signing up or making a purchase), that company pays us a commission. This is standard affiliate marketing.

**Q: Do I need to buy tokens?**
A: No. Creating an account and browsing referrals is completely free. You only need to connect a wallet if you want to receive bitxbit ecosystem credits.

**Token & Rewards**

**Q: How are token rewards calculated?**
A: A percentage of total affiliate income is allocated to community rewards each month. Your share depends on your participation level, the total income generated, and the published allocation model. Rewards are calculated and published in the Transparency Ledger.

**Q: Are rewards guaranteed?**
A: No. bitXbit tokens are community incentives, not guaranteed income. If no affiliate income is generated, no rewards are distributed. Past periods do not guarantee future rewards.

**Q: What are token buybacks?**
A: Buybacks use a portion of ecosystem income to purchase bitxbit tokens from the open market. This is a community-supported mechanism. It is not a price guarantee and does not imply any expectation of profit.

**Q: What is liquidity?**
A: Liquidity refers to the pool of tokens available for trading on decentralised exchanges. bitXbit allocates income to liquidity pools to support orderly trading. Providing liquidity yourself carries risks, including impermanent loss.

**Projects & Impact**

**Q: What projects does bitXbit fund?**
A: Currently, the New Earth Healing Clinic is our flagship funded project. We also allocate to liquidity building and token buybacks. More regenerative projects will be added as the ecosystem grows.

**Safety & Legal**

**Q: Is this financial advice?**
A: Absolutely not. Nothing on this website is financial, legal, or tax advice. Always do your own research and consult a licensed professional before making financial decisions.

**Q: How do I connect my wallet?**
A: In your dashboard, go to Profile and connect your Solana wallet (Phantom, Solflare, Backpack, etc.). You only need to provide your public address to receive credits.

**Q: How do I participate safely?**
A: Only use referral links for services you genuinely need. Never invest more than you can afford to lose. Be wary of scams — our only official domain is bitxbit.com.au. We will never ask for your seed phrase or private key.

**Q: Is bitXbit regulated?**
A: bitXbit is not a financial institution, investment manager, or securities issuer. We operate as a community referral ecosystem. Participants are responsible for ensuring their participation complies with local laws.

---

### PAGE: /legal/disclaimer

**Comprehensive Disclaimer & Disclosure**

**Affiliate Disclosure**
bitXbit participates in affiliate and referral programs. When you click certain links on this site and make a purchase or sign up, we may receive a commission at no additional cost to you. This income is used to support the bitXbit ecosystem, including community rewards, liquidity creation, token buybacks, and regenerative project funding.

**Token Reward Disclaimer**
bitXbit tokens (bitxbit) are ecosystem participation credits, not securities, investments, shares, or guaranteed income products. Token rewards are discretionary, depend on actual affiliate income, and are subject to the published allocation model. Past distributions do not guarantee future rewards. bitxbit has no inherent monetary value guaranteed by bitXbit.

**No Financial Advice**
All content on this site is for informational purposes only. It does not constitute financial, legal, tax, or investment advice. You should consult a qualified professional before making any financial decisions.

**Cryptocurrency Risk Warning**
Cryptocurrencies and tokens are highly volatile. You may lose all value. bitXbit does not guarantee the value, liquidity, or utility of bitxbit. Never participate with funds you cannot afford to lose.

**Eligibility & Jurisdiction**
Participation is void where prohibited by law. You must be at least 18 years old. Australian participants should ensure their activities comply with all applicable laws, including ASIC and ACCC guidance. Participants from other jurisdictions are responsible for their own compliance.

**No Liability**
bitXbit is not liable for any losses arising from your use of this site, referral links, or holding of bitxbit tokens. Use at your own risk.

---

### PAGE: /legal/privacy

[Standard Australian Privacy Principles aligned privacy policy to be drafted or adapted from a vetted template. Must cover: data collection, cookies, wallet addresses, email, third-party sharing, retention, user rights, contact.]

---

### PAGE: /legal/terms

[Standard terms of use to be drafted or adapted. Must cover: acceptance, eligibility, prohibited conduct, account termination, intellectual property, dispute resolution, governing law (likely NSW/Victoria depending on Shri's location), changes to terms.]

---

## 6. DASHBOARD UX PLAN

### Architecture: Two Portals, One Database

**Member Portal** (`app.bitxbit.com.au` or `/dashboard`)
**Admin Portal** (`app.bitxbit.com.au/admin`)

Both connect to the same Supabase backend. Role-based access control (RBAC) gates admin routes.

---

### MEMBER DASHBOARD — Screen-by-Screen

**Layout:** Left sidebar (200px, collapsible on mobile) + main content area.

**Sidebar:**
- Overview (home icon)
- My Profile (user icon)
- My Rewards (gift icon)
- My Activity (activity icon)
- Wallet (wallet icon)
- Transparency (book-open icon)
- Projects (globe icon)
- Settings (gear icon)
- Log Out

---

**Screen: Overview (Default)**

*Top bar:* "Welcome back, [Name]" + notification bell

*Card row 1 (3 columns):*
1. **Your Referral Clicks** — This month: XX | All time: XXX
2. **Actions Completed** — This month: XX | All time: XXX
3. **Reward Status** — Badge: "Calculating" / "Pending Distribution" / "Distributed"

*Card row 2 (highlighted panel, 2/3 width):*
**Your bitXbit Rewards**
- Estimated bitxbit for current period: X,XXX
- Total bitxbit allocated to date: X,XXX
- Last distribution: [Date] or "None yet"
- "View Reward History" link

*Card row 3 (visual):*
**Your Contribution to the Ecosystem**
- "You have helped generate $X.XX in affiliate value this month."
- Mini circular flow diagram with your personal impact highlighted

*Card row 4 (3 small stat cards):*
- **Liquidity Built** — Global: $XXX,XXX
- **Tokens Bought Back** — Global: XXX,XXX bitxbit
- **Projects Funded** — Global: $XX,XXX

*Card row 5:*
**Latest Opportunities** — 3 newest referral cards, "Explore All →"

---

**Screen: My Profile**
- Display name (editable)
- Email address (editable, re-verify required)
- Date joined
- Role: Community Member
- **Connected Solana Wallet**
  - Current address: `xxxx...xxxx` or "Not connected"
  - "Connect Wallet" button (opens Phantom/Solflare/etc.)
  - "Update Address" (manual input with validation)
  - Warning: "Never share your seed phrase. bitXbit will never ask for it."
- Notification preferences (email toggles)
- "Save Changes" button

---

**Screen: My Rewards**
- Table: Period | Estimated AUD Value | bitxbit Amount | Status | Tx Hash
- Filters: Status, Date Range
- "Export CSV" button
- Empty state: "No rewards yet. Start exploring referrals to generate ecosystem value."

---

**Screen: My Activity**
- Timeline view (newest first):
  - [Date] — Clicked Jupiter referral link
  - [Date] — Signed up via Phantom referral
  - [Date] — Account created
- Filter by activity type

---

**Screen: Wallet**
- Connected address display (full + truncated)
- Network: Solana
- "Copy Address" button
- "Disconnect / Change Wallet"
- "How wallet connection works" explainer:
  > "We only read your public wallet address. We cannot access your funds. We use this address to send bitxbit ecosystem credits. Always verify you are on bitxbit.com.au before connecting."

---

**Screen: Transparency (Read-Only)**
- Same data as public /transparency page
- Additional personal context: "Your participation contributed to X% of this month's affiliate flow."

---

### ADMIN DASHBOARD — Screen-by-Screen

**Sidebar:**
- Admin Overview
- Manage Offers
- Manage Categories
- Income Tracking
- Allocation Control
- Reward Distribution
- User Management
- Reports
- Publish Transparency Update
- Manage Projects

---

**Screen: Admin Overview**
- Total registered users: X,XXX
- Total affiliate income (this month): $X,XXX
- Total affiliate income (all time): $XXX,XXX
- Pending reward calculations: X periods
- Recent signups (last 7 days): XX
- Quick action buttons: "Add Offer", "Add Income", "Calculate Rewards", "Publish Report"

---

**Screen: Manage Offers**
- Table: Name | Category | Reward Eligible | Active | Clicks | Actions
- Actions: Edit / Duplicate / Deactivate / Delete
- "Add New Offer" button → Modal form:
  - Name, Category (dropdown), Referral URL, Description, Benefit Text, Reward Eligible (toggle), Active (toggle), Display Order, Logo URL

---

**Screen: Manage Categories**
- Drag-to-reorder list
- Name, Slug, Active toggle
- Add / Edit / Delete

---

**Screen: Income Tracking**
- "Add Income Entry" form:
  - Source (which offer), Amount, Currency (default AUD), Date Received, Proof Upload (file), Notes
- Table of all entries with filter by month
- "Total for [Month]: $X,XXX" auto-calculation
- Optional: Webhook/API integration for automated income import (future)

---

**Screen: Allocation Control**
- 5 sliders (must sum to 100%):
  - Community Rewards (%) — default 40
  - Liquidity (%) — default 25
  - Buybacks (%) — default 15
  - Projects (%) — default 10
  - Operations (%) — default 10
- "Save New Model" button
- "Effective Date" picker
- Historical models table (view-only)
- Warning: "Changes apply to future periods only. Pre-announce changes to the community."

---

**Screen: Reward Distribution**
- Step 1: Select period (start / end date)
- Step 2: "Calculate Rewards" — system runs allocation logic
- Step 3: Review table (User | Activity Score | Estimated AUD | bitxbit Amount)
- Step 4: Approve or Adjust
- Step 5: "Mark as Distributed" (with optional on-chain tx hash batch upload)
- Export: CSV for bulk token distribution

---

**Screen: User Management**
- Searchable table: Name | Email | Wallet | Role | Status | Joined
- Actions: View Activity, Edit Wallet, Suspend, Change Role
- "Export User List" CSV

---

**Screen: Reports**
- Generate CSV exports:
  - Users (date range)
  - Rewards (by period)
  - Income (by source)
  - Offers (performance)
- Date range picker for all reports

---

**Screen: Publish Transparency Update**
- Form:
  - Month / Year
  - Total Income (auto-filled, editable)
  - Allocation snapshot (auto-filled from active model)
  - Summary text (rich text)
  - Proof file uploads (multi-file)
- "Publish" button → pushes to public /transparency page
- "Save Draft" button

---

**Screen: Manage Projects**
- CRUD for projects
- Fields: Name, Description, Funding Goal, Amount Allocated, Status, Impact Statement, Image
- Allocate funds from project funding pool
- Update status and progress percentage

---

## 7. DASHBOARD DATA MODEL

### Entity Relationship Diagram (Text)

```
User ||--o{ UserActivity : generates
User ||--o{ UserReward : receives
User ||--o{ AffiliateIncome : records (admin)
User ||--o{ TransparencyReport : publishes (admin)
User ||--o{ Project : manages (admin)

AffiliateOffer }o--|| Category : belongs_to
AffiliateOffer ||--o{ UserActivity : generates

AffiliateIncome ||--|| RewardPeriod : belongs_to
AllocationModel ||--o{ RewardPeriod : used_in
RewardPeriod ||--o{ UserReward : contains

Project ||--o{ ProjectAllocation : funded_by
```

### Table Specifications

**users**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default gen_random_uuid() |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| display_name | VARCHAR(100) | |
| wallet_address | VARCHAR(44) | nullable, Solana base58 |
| role | VARCHAR(20) | DEFAULT 'member', CHECK (role IN ('member', 'admin')) |
| status | VARCHAR(20) | DEFAULT 'active', CHECK (status IN ('active', 'suspended')) |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| last_login | TIMESTAMPTZ | |
| email_verified | BOOLEAN | DEFAULT false |

**categories**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| name | VARCHAR(100) | NOT NULL |
| slug | VARCHAR(100) | UNIQUE, NOT NULL |
| display_order | INT | DEFAULT 0 |
| active | BOOLEAN | DEFAULT true |

**affiliate_offers**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| name | VARCHAR(200) | NOT NULL |
| category_id | UUID | FK → categories |
| referral_url | TEXT | NOT NULL |
| description | TEXT | |
| benefit_text | VARCHAR(255) | |
| reward_eligible | BOOLEAN | DEFAULT true |
| active | BOOLEAN | DEFAULT true |
| display_order | INT | DEFAULT 0 |
| logo_url | TEXT | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**user_activities**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| user_id | UUID | FK → users, INDEX |
| offer_id | UUID | FK → affiliate_offers, nullable |
| activity_type | VARCHAR(50) | CHECK ('click', 'signup', 'purchase', 'other') |
| source_url | TEXT | |
| ip_address | INET | |
| user_agent | TEXT | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**affiliate_income**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| source | VARCHAR(200) | NOT NULL |
| offer_id | UUID | FK → affiliate_offers, nullable |
| amount | DECIMAL(12,2) | NOT NULL |
| currency | VARCHAR(3) | DEFAULT 'AUD' |
| date_received | DATE | NOT NULL |
| proof_url | TEXT | |
| notes | TEXT | |
| created_by | UUID | FK → users |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**allocation_models**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| name | VARCHAR(100) | NOT NULL |
| community_rewards_pct | DECIMAL(5,2) | NOT NULL, CHECK (0-100) |
| liquidity_pct | DECIMAL(5,2) | NOT NULL |
| buybacks_pct | DECIMAL(5,2) | NOT NULL |
| projects_pct | DECIMAL(5,2) | NOT NULL |
| operations_pct | DECIMAL(5,2) | NOT NULL |
| is_active | BOOLEAN | DEFAULT false |
| effective_date | DATE | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| CONSTRAINT | | CHECK (sum of all pct = 100) |

**reward_periods**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| start_date | DATE | NOT NULL |
| end_date | DATE | NOT NULL |
| total_income | DECIMAL(12,2) | DEFAULT 0 |
| allocation_model_id | UUID | FK → allocation_models |
| status | VARCHAR(20) | DEFAULT 'calculating', CHECK ('calculating', 'approved', 'distributed') |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**user_rewards**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| user_id | UUID | FK → users, INDEX |
| reward_period_id | UUID | FK → reward_periods |
| estimated_aud_value | DECIMAL(12,2) | |
| bitxbit_amount | DECIMAL(18,8) | |
| status | VARCHAR(20) | DEFAULT 'pending', CHECK ('pending', 'approved', 'distributed', 'rejected') |
| distribution_tx_hash | VARCHAR(100) | nullable |
| distributed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**projects**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| name | VARCHAR(200) | NOT NULL |
| description | TEXT | |
| funding_goal | DECIMAL(12,2) | |
| amount_allocated | DECIMAL(12,2) | DEFAULT 0 |
| status | VARCHAR(20) | DEFAULT 'planning', CHECK ('planning','active','completed','paused') |
| impact_statement | TEXT | |
| image_url | TEXT | |
| display_order | INT | DEFAULT 0 |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**transparency_reports**
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| report_month | VARCHAR(20) | NOT NULL |
| report_year | INT | NOT NULL |
| total_income | DECIMAL(12,2) | |
| allocation_snapshot | JSONB | |
| summary_text | TEXT | |
| proof_urls | TEXT[] | |
| published_by | UUID | FK → users |
| published_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

---

## 8. WEBFLOW CMS STRUCTURE

Marketing site content is managed in Webflow CMS. Dashboard data lives in Supabase.

### Collection: Affiliate Offers
| Field | Type | Notes |
|-------|------|-------|
| Name | Plain Text | |
| Category | Reference | → Categories collection |
| Description | Rich Text | 1-2 paragraphs max |
| Benefit to User | Plain Text | e.g., "Get $20 BTC" |
| Referral URL | Link | External, nofollow if needed |
| Reward Eligible | Switch | |
| Active | Switch | |
| Featured | Switch | For homepage preview |
| Logo | Image | SVG or PNG, 200x200 ideal |
| Display Order | Number | |

### Collection: Categories
| Field | Type | Notes |
|-------|------|-------|
| Name | Plain Text | |
| Slug | Plain Text | URL-friendly |
| Display Order | Number | |
| Active | Switch | |

### Collection: Projects
| Field | Type | Notes |
|-------|------|-------|
| Name | Plain Text | |
| Description | Rich Text | |
| Funding Goal | Number | |
| Amount Allocated | Number | Manual update from admin |
| Status | Option | Planning / Active / Completed / Paused |
| Impact Statement | Plain Text | |
| Featured Image | Image | |
| Progress Percentage | Number | 0-100 |

### Collection: FAQ Items
| Field | Type | Notes |
|-------|------|-------|
| Question | Plain Text | |
| Answer | Rich Text | |
| Category | Option | General / Token / Rewards / Legal / Safety |
| Display Order | Number | |

### Collection: Transparency Reports
| Field | Type | Notes |
|-------|------|-------|
| Month | Plain Text | e.g., "May 2025" |
| Year | Number | |
| Total Income | Number | |
| Community Rewards % | Number | |
| Liquidity % | Number | |
| Buybacks % | Number | |
| Projects % | Number | |
| Operations % | Number | |
| Summary | Rich Text | |
| Proof Files | Multi-Image | Screenshots, PDFs |
| Published Date | Date | |

### Collection: Ecosystem Updates
| Field | Type | Notes |
|-------|------|-------|
| Title | Plain Text | |
| Content | Rich Text | |
| Category | Option | Update / Milestone / New Offer / Project |
| Published Date | Date | |
| Featured | Switch | For dashboard "Latest Updates" |

---

## 9. AUTHENTICATION & WALLET CONNECTION

### Authentication Strategy: Phased Rollout

**Phase 1 (Launch):**
- **Primary:** Magic Link (passwordless email) via Supabase Auth
- **Secondary:** Social login (Google) via Supabase Auth
- **Why:** Lowest friction, no password management, secure, works for everyone including non-crypto-natives

**Phase 2 (Post-launch):**
- Add Solana wallet authentication (sign-in with wallet)
- Options: Solana Wallet Adapter (Phantom, Solflare, Backpack, Glow)
- Wallet can be primary auth OR linked to existing email account

### Wallet Connection (Rewards Only)

**Current State:** Token is Solana-native (contract: `DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5`)

**Member Dashboard Wallet Flow:**
1. User goes to Profile or Wallet screen
2. "Connect Solana Wallet" button
3. Opens Solana Wallet Adapter modal
4. User selects wallet (Phantom, Solflare, etc.)
5. App receives public key only
6. Address saved to user profile
7. Future bitxbit credits sent to this address

**Security Requirements:**
- NEVER request seed phrase or private key
- NEVER request transaction signing except for optional on-chain distribution claims
- Clear warning banner: "bitXbit will NEVER ask for your seed phrase."
- Verify domain: only trust bitxbit.com.au and app.bitxbit.com.au

### Admin Authentication
- Same auth system, role-gated via `users.role = 'admin'`
- Row Level Security (RLS) policies in Supabase enforce:
  - Members can only read their own data
  - Admins can read/write all data
- Consider 2FA for admin accounts (Supabase supports via MFA)

---

## 10. DASHBOARD TECHNOLOGY OPTIONS — EVALUATION

### Option 1: Webflow + Memberstack
| Criteria | Rating |
|----------|--------|
| Ease of setup | ⭐⭐⭐⭐ |
| Custom database | ⭐⭐ |
| Admin tools | ⭐ |
| Solana wallet support | ⭐ |
| Scalability | ⭐⭐ |
| Cost | ⭐⭐⭐ |

**Verdict:** Too limited. Memberstack is built for content gating, not custom dashboards with admin CRUD, reward calculations, and transparency ledgers.

---

### Option 2: Webflow + Wized + Xano
| Criteria | Rating |
|----------|--------|
| Ease of setup | ⭐⭐⭐ |
| Custom database | ⭐⭐⭐⭐ |
| Admin tools | ⭐⭐⭐ |
| Solana wallet support | ⭐⭐ |
| Scalability | ⭐⭐⭐ |
| Cost | ⭐⭐⭐⭐ |

**Verdict:** Powerful but adds vendor lock-in and learning curve. Wized logic can become complex. Xano is solid but you're paying for two specialised platforms.

---

### Option 3: Webflow + Supabase — RECOMMENDED
| Criteria | Rating |
|----------|--------|
| Ease of setup | ⭐⭐⭐ |
| Custom database | ⭐⭐⭐⭐⭐ |
| Admin tools | ⭐⭐⭐⭐ (custom build) |
| Solana wallet support | ⭐⭐⭐⭐⭐ (via React) |
| Scalability | ⭐⭐⭐⭐⭐ |
| Cost | ⭐⭐ (generous free tier) |

**Pros:**
- PostgreSQL with full relational integrity (critical for financial-adjacent data)
- Built-in Auth with RLS
- Free tier handles significant volume
- Can build React dashboard separately while keeping Webflow for marketing
- Solana wallet adapters work natively in React
- Edge Functions for reward calculations
- Storage for proof files

**Cons:**
- Requires frontend development (React/Next.js)
- Not no-code for dashboard portion

**Verdict:** Best balance of power, cost, and flexibility.

---

### Option 4: Webflow + Firebase
| Criteria | Rating |
|----------|--------|
| Ease of setup | ⭐⭐⭐ |
| Custom database | ⭐⭐⭐ (Firestore is document-based) |
| Admin tools | ⭐⭐⭐ |
| Solana wallet support | ⭐⭐⭐⭐ |
| Scalability | ⭐⭐⭐⭐ |
| Cost | ⭐⭐⭐ (can spike) |

**Verdict:** Firestore's document model is weaker for relational financial data. Pricing surprises possible. Google ecosystem lock-in.

---

### Option 5: Custom React Dashboard + Webflow Marketing Site
| Criteria | Rating |
|----------|--------|
| Ease of setup | ⭐⭐ |
| Custom database | ⭐⭐⭐⭐⭐ |
| Admin tools | ⭐⭐⭐⭐⭐ |
| Solana wallet support | ⭐⭐⭐⭐⭐ |
| Scalability | ⭐⭐⭐⭐⭐ |
| Cost | ⭐⭐⭐ (hosting + db) |

**Pros:**
- Complete UX control
- Best dashboard experience possible
- Separate deployment cycles for marketing vs product

**Cons:**
- Two codebases
- More upfront development

**Verdict:** This is actually the *implementation* of Option 3. The marketing site stays in Webflow. The dashboard is custom React. They share Supabase as backend.

---

### FINAL ARCHITECTURE RECOMMENDATION

```
MARKETING SITE          DASHBOARD (MEMBER + ADMIN)
bitxbit.com.au          app.bitxbit.com.au
    |                       |
    v                       v
  Webflow               Next.js 14+ (App Router)
  (Pages + CMS)              |
                             v
                        Supabase
                        - PostgreSQL
                        - Auth (Magic Link + Social)
                        - Storage (proof files)
                        - Edge Functions (reward calc)
                        - Realtime (optional live stats)
                             |
                             v
                        Solana Wallet Adapter
                        (Phantom, Solflare, etc.)
```

**Webflow** = marketing pages, CMS for offers/projects/FAQs/transparency
**Next.js** = dashboard UI (member + admin), wallet connection
**Supabase** = database, auth, file storage, serverless functions
**Vercel/Netlify** = host Next.js app
**Solana** = blockchain for bitxbit token (existing)

---

## 11. STAGED IMPLEMENTATION ROADMAP

### PHASE 0: Pre-Build Compliance Clean-Up (Week 0)
- [ ] Immediate: Add basic disclaimer to CURRENT live site
  - "bitXbit tokens are not investment products. This is not financial advice."
  - "Participate at your own risk."
- [ ] Add affiliate disclosure to current page (it already links to exchanges)
- [ ] Add crypto risk warning
- [ ] This protects the project while the rebuild is in progress

### PHASE 1: Foundation (Weeks 1-3)
- [ ] Finalise brand identity: colour palette, typography, logo refinement
- [ ] Build Webflow component library (nav, cards, buttons, sections)
- [ ] Set up Supabase project with full schema
- [ ] Set up Next.js dashboard scaffold (App Router, Tailwind, shadcn/ui)
- [ ] Configure Supabase Auth (Magic Link + Google)
- [ ] Connect Webflow and Next.js to Supabase

### PHASE 2: Marketing Site (Weeks 4-6)
- [ ] Build homepage in Webflow
- [ ] Build /how-it-works, /token-economy, /projects, /faq
- [ ] Build /referrals with CMS-driven card grid
- [ ] Build /transparency with CMS-driven reports
- [ ] Build all /legal pages (disclaimer, privacy, terms, affiliate, risk)
- [ ] Populate CMS: 5-10 launch offers, 1 project, 5-10 FAQs
- [ ] Mobile responsiveness + accessibility check
- [ ] Legal review of all copy

### PHASE 3: Member Dashboard MVP (Weeks 7-9)
- [ ] Auth flow: signup, login, magic link
- [ ] Overview screen with stats
- [ ] Profile + wallet connection (Solana Wallet Adapter)
- [ ] My Rewards (read-only, mock data initially)
- [ ] My Activity timeline
- [ ] Transparency read-only view
- [ ] Deploy to app.bitxbit.com.au

### PHASE 4: Admin Dashboard (Weeks 10-11)
- [ ] Role-based access (admin gates)
- [ ] Manage Offers CRUD
- [ ] Manage Categories
- [ ] Income Tracking (manual entry)
- [ ] Allocation Control sliders
- [ ] User Management table
- [ ] Publish Transparency Update flow
- [ ] Project Management CRUD

### PHASE 5: Reward Engine (Weeks 12-13)
- [ ] Reward calculation logic (Edge Function)
- [ ] Period creation and approval workflow
- [ ] CSV export for distribution
- [ ] Mark distributed + tx hash upload
- [ ] Member notification emails

### PHASE 6: Launch & Hardening (Week 14)
- [ ] Security audit: RLS policies, input validation, auth flows
- [ ] Performance optimisation (Lighthouse 90+)
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Cross-browser testing
- [ ] Launch: point bitxbit.com.au to new Webflow site
- [ ] Launch: app.bitxbit.com.au live
- [ ] Post-launch monitoring

### PHASE 7: Post-Launch Growth (Ongoing)
- [ ] On-chain reward distribution (automated or batch)
- [ ] Automated affiliate income integrations (APIs)
- [ ] Governance voting on allocations
- [ ] Additional Solana wallet integrations
- [ ] PWA capabilities for dashboard
- [ ] Analytics and conversion optimisation

---

## APPENDIX A: CRITICAL COMPLIANCE ACTIONS FOR CURRENT SITE

Before the rebrand launches, the existing live site needs immediate protection:

1. **Add to hero section:**
   "Not financial advice. bitXbit is a community token on Solana. Participate at your own risk."

2. **Add to footer:**
   - Affiliate Disclosure
   - Crypto Risk Warning
   - "Not an investment product"

3. **Remove or soften:**
   - "Build your Wealth" → "Community token on Solana"
   - "creating crypto abundance for HODLers" → "community-driven Solana ecosystem"
   - "DeGen token" → at minimum add context that it's experimental

These are emergency edits that can be made in Webflow in under 30 minutes while the full rebrand is built.

---

## APPENDIX B: DESIGN TOKENS

| Token | Value | Usage |
|-------|-------|-------|
| --color-bg-primary | #0A0E1A | Page background |
| --color-bg-secondary | #111827 | Cards, panels |
| --color-bg-tertiary | #1A2236 | Elevated surfaces, inputs |
| --color-accent-primary | #3B82F6 | CTAs, links, active states |
| --color-accent-secondary | #F59E0B | Rewards, highlights, gold accents |
| --color-accent-glow | rgba(59,130,246,0.15) | Subtle blue glows |
| --color-text-primary | #F8FAFC | Headings, primary text |
| --color-text-secondary | #94A3B8 | Body copy |
| --color-text-muted | #64748B | Labels, meta |
| --color-success | #10B981 | Positive, distributed |
| --color-warning | #F59E0B | Pending, calculating |
| --color-error | #EF4444 | Rejected, error |
| --font-heading | Geist or Inter | Display, headlines |
| --font-body | Inter | Body, UI text |
| --radius-card | 12px | Cards |
| --radius-button | 8px | Buttons |
| --shadow-card | 0 4px 24px rgba(0,0,0,0.3) | Card elevation |

---

## APPENDIX C: SLOGAN & TAGLINE OPTIONS

**Primary options for homepage:**
1. "Turn everyday referrals into shared digital abundance." (recommended)
2. "The referral layer for a regenerative token economy."
3. "Building liquidity, rewards, and regeneration — bit by bit."

**Secondary/tagline options:**
- "Referral income. Shared rewards. Real-world impact."
- "A circular economy powered by everyday referrals."
- "Click by click, bit by bit."

**Legal-safe framing:**
- "Community-powered. Transparency-led. Regenerative by design."
- "Not an investment. A participation ecosystem."

---

*Document Version: 2.0*
*Live Audit Date: 25 May 2026*
*Status: Strategic Blueprint — Pending Approval*
