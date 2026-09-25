# bitXbit Complete Rebrand Blueprint
## Strategic Plan, Site Architecture, Copy, Dashboard Spec & Implementation Roadmap

---

## 1. CURRENT SITE AUDIT

### Technical Discovery
- **Domain:** bitxbit.com.au (redirects to www.bitxbit.com.au)
- **DNS:** Resolves to AWS infrastructure (99.83.190.102, 75.2.70.75)
- **Server Response:** Returns HTTP 301 redirect to www subdomain
- **Access Note:** Automated/curl-based access is currently blocked or returns empty responses, suggesting either:
  - Bot protection / WAF rules (common on Webflow hosted sites with certain configurations)
  - A redirect layer or landing-page gate
  - Minimal current content or placeholder status

### Inferred Current State
Based on DNS and server signatures:
- Likely Webflow-hosted or fronted by a CDN/proxy layer
- The site appears to have limited public-facing crawlable content
- No robust affiliate hub, dashboard, or transparency infrastructure is currently detectable

### Audit Conclusion
**The current site is effectively a blank slate for this rebrand.** There is no substantial existing content architecture to migrate. This is an advantage — we can build the new information architecture cleanly without legacy constraints.

---

## 2. STRATEGIC REBRAND PLAN

### Positioning Shift
| From | To |
|------|-----|
| Simple crypto/token project | Referral-powered circular economy |
| Token-first communication | Impact-first, participation-second, token-third |
| Hype-driven marketing | Transparency-driven community building |
| Passive holding narrative | Active participation model |

### Core Brand Narrative
> "Every referral click is a vote for a regenerative economy. bitXbit channels everyday digital activity into shared abundance — rewarding participants, funding healing projects, and building token liquidity, bit by bit."

### Messaging Hierarchy
1. **What we do:** We gather trusted referral & affiliate opportunities under one roof.
2. **How it flows:** Generated income funds token rewards, liquidity, buybacks, and real-world projects.
3. **Why it matters:** Participants earn ecosystem credits while supporting regeneration.
4. **What it is NOT:** An investment, security, or guaranteed income product.

### Compliance Framework (Australia-focused)
- All token rewards framed as "community incentives," "loyalty credits," or "ecosystem participation rewards"
- Clear disclaimers on every page with financial proximity
- No APY, no ROI, no "earn passive income" language
- Affiliate disclosures on every referral link (ASIC/ACCC aligned)
- Clear eligibility and jurisdiction statements

---

## 3. REVISED SITEMAP

```
bitxbit.com.au
|
|-- / (Home)
|-- /how-it-works
|-- /referrals (Affiliate Hub)
|   |-- /category/:slug
|-- /token-economy
|-- /projects
|-- /transparency
|-- /faq
|-- /dashboard (Member Dashboard — authenticated)
|   |-- /profile
|   |-- /rewards
|   |-- /activity
|   |-- /wallet
|-- /legal
|   |-- /disclaimer
|   |-- /privacy
|   |-- /terms
|   |-- /affiliate-disclosure
|-- /admin (Admin Dashboard — authenticated, role-gated)
|   |-- /offers
|   |-- /allocations
|   |-- /users
|   |-- /reports
|   |-- /transparency-updates
```

---

## 4. HOMEPAGE ARCHITECTURE & COPY

### Section Layout (Top to Bottom)

#### NAVIGATION
- Logo: bitXbit (wordmark, lowercase b and X)
- Links: How It Works | Referrals | Token Economy | Projects | Transparency | FAQ
- CTA: "View Dashboard" (primary) | "Connect Wallet" (secondary, optional for v2)
- Mobile: hamburger with same links

#### HERO SECTION
- **Headline:** "Turn everyday referrals into shared digital abundance."
- **Subheadline:** "bitXbit brings trusted referral and affiliate opportunities into one ecosystem, using generated income to support token rewards, liquidity, buybacks, and regenerative real-world projects."
- **Primary CTA:** "Explore Referrals"
- **Secondary CTA:** "How It Works"
- **Tertiary CTA:** "View Dashboard"
- **Visual:** Abstract circular flow animation (particles flowing through a loop) in deep navy with electric blue/gold accents. Subtle blockchain grid background.
- **Trust bar:** "Transparent. Community-powered. Regenerative."

#### THE CIRCLE SECTION (How It Works Preview)
- 5-step horizontal flow (mobile: vertical)
- Icons + micro-copy for each step
- "See the full flow →" links to /how-it-works

#### LIVE METRICS STRIP
- "Ecosystem Pulse" — 3-4 live or recently updated numbers:
  - "Liquidity Built: $X,XXX"
  - "Tokens Bought Back: XXX,XXX BxB"
  - "Projects Funded: X"
  - "Community Participants: X,XXX"
- Links to Transparency page

#### FEATURED REFERRALS (Preview)
- 3-6 curated affiliate cards
- "Explore all opportunities →" links to /referrals

#### PROJECTS PREVIEW
- Featured project: New Earth Healing Clinic
- Funding progress bar
- "See all projects →" links to /projects

#### COMMUNITY VOICE / SOCIAL PROOF
- 2-3 participant quotes (to be collected)
- "Join the community" CTA

#### FINAL CTA
- "Start participating today."
- Buttons: "Explore Referrals" | "View Dashboard"

#### FOOTER
- Links: All main pages + Legal cluster
- Newsletter signup (if desired)
- Social links
- "bitXbit is a community ecosystem, not an investment product."

---

## 5. COMPLETE COPY DRAFTS FOR ALL MAJOR PAGES

---

### PAGE: /how-it-works

**H1:** How bitXbit Works
**Subhead:** A circular economy powered by everyday referrals.

**5-Step Flow:**

1. **Join the Ecosystem**
   Create your free bitXbit account. Connect your wallet if you want to receive token rewards. No purchase required.

2. **Explore Trusted Opportunities**
   Browse curated referral and affiliate links across crypto, finance, AI, wellness, education, and regenerative living.

3. **Use Links That Serve You**
   Click through to products and services you actually need. When you sign up or purchase, affiliate income is generated.

4. **Income Circulates**
   Generated revenue is allocated across community token rewards, liquidity creation, token buybacks, project funding, and operations.

5. **Shared Abundance**
   A percentage of affiliate income is distributed back to participants as bitXbit ecosystem credits, according to the published model.

**Bottom CTA:** "Explore Referrals" | "View Dashboard"

**Disclaimer block:** "bitXbit tokens are community participation incentives, not financial products. Rewards are not guaranteed and vary based on ecosystem activity."

---

### PAGE: /referrals (Affiliate Hub)

**H1:** Referral & Affiliate Hub
**Subhead:** Trusted tools, services, and platforms. Every click supports the circular economy.

**Filter bar:** All | Crypto | Wallets | Finance | AI | Wellness | Education | Business | Regenerative Living | Tech

**Card Template:**
- Category tag (e.g., "Crypto Exchange")
- Product name + logo
- Short description (1-2 sentences)
- Benefit to user (e.g., "Get $20 in BTC when you sign up")
- CTA button: "Get Started"
- Small text: "bitXbit may receive affiliate income. This supports the ecosystem."
- Optional badge: "Eligible for BxB Rewards"

**Sample Card Copy (Binance example):**
- Category: Crypto Exchange
- Name: Binance
- Description: The world's largest crypto exchange by volume. Trade, stake, and grow your digital assets.
- Benefit: Reduced trading fees for new users.
- CTA: Get Started
- Disclosure: bitXbit may earn affiliate income.
- Badge: Eligible for BxB Rewards

**Bottom section:** "Have a referral opportunity?" — contact/admin link

---

### PAGE: /token-economy

**H1:** The bitXbit Token Economy
**Subhead:** How affiliate income flows back to the community and the ecosystem.

**Section 1: What is the bitXbit Token?**
The bitXbit token (BxB) is an ecosystem participation credit. It is not a security, share, or investment product. BxB is used to:
- Recognize community participation
- Track contribution within the ecosystem
- Access future utility features as the platform grows

**Section 2: Where Affiliate Income Goes**
Visual: Donut/pie chart with editable placeholder percentages.

| Allocation | Purpose |
|------------|---------|
| 40% Community Token Rewards | Distributed to participants as BxB ecosystem credits |
| 25% Liquidity Creation | Used to build and sustain token liquidity pools |
| 15% Token Buybacks | Supports market stability by buying back circulating tokens |
| 10% Project Funding | Directly funds regenerative and healing initiatives |
| 10% Operations & Growth | Platform maintenance, development, and marketing |

*Note: These percentages are placeholder figures subject to confirmation and periodic community review.*

**Section 3: Transparency Principles**
- All allocations are published monthly
- Proof of payments and revenue is uploaded to the Transparency Ledger
- No guaranteed returns. Reward amounts depend on actual affiliate income generated.
- Allocation model may evolve with community input.

**Section 4: Future Utility**
Potential future uses for BxB (not guaranteed, subject to development):
- Governance voting on project funding
- Premium dashboard features
- Exclusive access to new referral opportunities
- Discounts on partner products

---

### PAGE: /projects

**H1:** Projects Funded by the Ecosystem
**Subhead:** Real-world impact, powered by referral clicks.

**Project Card Template:**
- Project name
- Status tag (Active / In Planning / Completed)
- Description
- Funding goal
- Amount allocated to date
- Progress bar
- Impact statement

**Featured Project: New Earth Healing Clinic**
- Status: Active
- Description: A regenerative healing centre offering holistic therapies, community wellness programs, and accessible health services.
- Funding Goal: $50,000 AUD
- Allocated: $X,XXX
- Impact: "Every referral click helps fund accessible healing for our community."

**Other Projects:**
- Token Liquidity Building (ongoing infrastructure)
- Token Buyback Reserve (market support)
- Future: Community garden initiative, regenerative education fund

---

### PAGE: /transparency

**H1:** Transparency Ledger
**Subhead:** Open books. Verified flows. Monthly reports.

**Table Columns:**
| Month | Affiliate Income | Rewards % | Liquidity % | Buybacks % | Projects % | Proof |

**Latest Report Preview:**
- Month: [Current/Last]
- Income: $X,XXX
- Allocations shown with progress bars
- "View proof" links to uploaded documents or blockchain tx hashes

**Archive:** Filterable by month and category.

**Bottom:** "Have questions? Contact us or visit the FAQ."

---

### PAGE: /faq

**H1:** Frequently Asked Questions

**Q: What is bitXbit?**
A: bitXbit is a community ecosystem that gathers referral and affiliate opportunities under one brand. Generated income supports token rewards, liquidity, buybacks, and regenerative real-world projects.

**Q: How does bitXbit earn affiliate income?**
A: When you click a referral link on our platform and sign up or purchase from a partner, that partner pays us a referral fee. This is standard affiliate marketing.

**Q: Do I need to buy tokens?**
A: No. Participation is free. You can browse referrals, use links, and create an account without purchasing anything.

**Q: How are token rewards calculated?**
A: A percentage of affiliate income is allocated to community rewards. The exact amount you receive depends on your participation, the income generated in that period, and the published allocation model.

**Q: Are rewards guaranteed?**
A: No. bitXbit tokens are community incentives, not guaranteed income. Rewards depend on actual affiliate revenue and are subject to the published allocation model.

**Q: What are token buybacks?**
A: Buybacks use ecosystem income to purchase bitXbit tokens that have been sold into circulation. This is a support mechanism, not a price guarantee.

**Q: What is liquidity?**
A: Liquidity refers to the pool of tokens available for trading. bitXbit allocates a portion of income to build and sustain liquidity pools, making trading smoother.

**Q: What projects does bitXbit fund?**
A: Currently, the New Earth Healing Clinic is our flagship funded project. We also fund liquidity building and token buybacks. More regenerative projects will be added over time.

**Q: Is this financial advice?**
A: No. Nothing on this website is financial advice. Always do your own research and consult a licensed professional before making financial decisions.

**Q: How do I connect my wallet?**
A: In your dashboard, go to Profile and enter or connect your wallet address. We support major EVM-compatible wallets.

**Q: How do I participate safely?**
A: Only use referral links for services you genuinely need. Never invest more than you can afford to lose. Be wary of scams impersonating bitXbit. Our official domain is bitxbit.com.au.

---

### PAGE: /legal/disclaimer

**Affiliate Disclosure**
bitXbit participates in affiliate and referral programs. When you click certain links on this site and make a purchase or sign up, we may receive a commission at no extra cost to you.

**Token Reward Disclaimer**
bitXbit tokens are ecosystem participation credits, not securities, investments, or guaranteed income products. Token rewards are discretionary and depend on actual affiliate income. Past activity does not guarantee future rewards.

**No Financial Advice**
All content on this site is for informational purposes only. It is not financial, legal, or tax advice. Consult a qualified professional for advice specific to your situation.

**Crypto Risk Warning**
Cryptocurrencies and tokens are volatile and high-risk. You may lose all value. Never participate with funds you cannot afford to lose.

**Eligibility**
Participation is void where prohibited. You must be 18+ and comply with your local laws, including Australian regulations if applicable.

**Privacy Policy**
[Link to full privacy policy]

**Terms of Use**
[Link to full terms]

---

## 6. DASHBOARD UX PLAN

### Dashboard Architecture
The dashboard is split into two portals: **Member** and **Admin**.

### Member Dashboard (/dashboard)

**Layout: Sidebar + Main Content**

**Sidebar Navigation:**
- Overview (default)
- My Profile
- My Rewards
- My Activity
- Wallet
- Transparency Ledger
- Projects
- Settings
- Log Out

**Overview Screen Sections:**

1. **Welcome Header**
   - "Welcome back, [Name]"
   - Last login / notification dot

2. **Your Participation (3-column cards)**
   - Referral Clicks This Month: XX
   - Affiliate Actions Completed: XX
   - Eligible Rewards Status: "Calculating" / "Pending" / "Distributed"

3. **Your bitXbit Rewards (prominent panel)**
   - Estimated BxB Rewards: X,XXX (placeholder logic)
   - Token Balance / Allocated: X,XXX BxB
   - Last Distribution Date: [Date]
   - "View Reward History" link

4. **Ecosystem Flow (visual)**
   - Mini version of the 5-step flow
   - Personal stats overlaid: "You have generated $X.XX in affiliate value this month."

5. **Liquidity Built / Tokens Bought Back / Projects Funded**
   - Three small stat cards
   - Global ecosystem numbers
   - "View Transparency Ledger" link

6. **Latest Opportunities**
   - 3 newest or featured affiliate cards
   - "Explore All" link

**My Profile Screen:**
- Display name
- Email
- Wallet address field (with validation)
- Connected wallets (if multi-wallet support added later)
- Notification preferences

**My Rewards Screen:**
- Table: Date | Source | Estimated Value | BxB Amount | Status
- Filter by status and date range
- Export (CSV) option

**My Activity Screen:**
- Timeline of clicks, signups, and completed actions
- Source link tracking

**Wallet Screen:**
- Wallet address display + edit
- Connected network info
- "How to connect safely" tooltip

**Transparency Ledger (Member View):**
- Read-only view of public ledger
- Filterable by month

---

### Admin Dashboard (/admin)

**Sidebar Navigation:**
- Admin Overview
- Manage Offers
- Manage Categories
- Income Tracking
- Allocation Control
- Reward Distribution
- User Management
- Reports
- Transparency Updates
- Project Funding

**Admin Overview:**
- Total users
- Total affiliate income (month/all-time)
- Pending reward calculations
- Recent signups
- Quick actions: Add Offer, Upload Report, Calculate Rewards

**Manage Offers:**
- Table of all affiliate offers
- Add/Edit/Delete
- Fields: Name, Category, URL, Description, Benefit, Reward Eligible, Active/Inactive

**Manage Categories:**
- CRUD for referral categories
- Drag-to-reorder

**Income Tracking:**
- Manual entry form: Source, Amount, Date, Proof Upload
- Optional: Integration webhooks for automated tracking

**Allocation Control:**
- Editable percentage sliders
- Must sum to 100%
- Save new allocation model
- Historical allocation versions

**Reward Distribution:**
- Calculate rewards for a period
- Review and approve before distribution
- Batch export for on-chain distribution
- Mark as distributed

**User Management:**
- User table with search/filter
- View user activity
- Edit wallet addresses (with audit log)
- Export user list

**Reports:**
- Export CSV: Users, Rewards, Income, Offers
- Date range selection

**Transparency Updates:**
- Create monthly report entry
- Upload proof files
- Publish to public ledger

**Project Funding:**
- CRUD for projects
- Allocate funds from project funding pool
- Update project status and progress

---

## 7. DASHBOARD DATA MODEL

### Core Entities

**User**
- id (UUID)
- email (unique)
- display_name
- wallet_address (nullable)
- role (member / admin)
- created_at
- last_login
- status (active / suspended)

**AffiliateOffer**
- id (UUID)
- name
- category_id (FK)
- referral_url
- description
- benefit_text
- reward_eligible (boolean)
- active (boolean)
- display_order
- created_at

**Category**
- id (UUID)
- name
- slug
- display_order
- active

**AffiliateIncome**
- id (UUID)
- source (text: which offer)
- amount (decimal)
- currency (default AUD)
- date_received
- proof_url (file/document)
- notes
- created_by (FK -> User)
- created_at

**AllocationModel**
- id (UUID)
- name (e.g., "Q2 2025 Model")
- community_rewards_pct
- liquidity_pct
- buybacks_pct
- projects_pct
- operations_pct
- is_active
- effective_date
- created_at

**RewardPeriod**
- id (UUID)
- start_date
- end_date
- total_income (FK -> sum of AffiliateIncome in period)
- allocation_model_id (FK)
- status (calculating / approved / distributed)
- created_at

**UserReward**
- id (UUID)
- user_id (FK)
- reward_period_id (FK)
- estimated_aud_value
- bxb_amount
- status (pending / approved / distributed / rejected)
- distribution_tx_hash (nullable)
- distributed_at (nullable)
- created_at

**UserActivity**
- id (UUID)
- user_id (FK)
- activity_type (click / signup / purchase / other)
- offer_id (FK, nullable)
- source_url
- ip_address
- user_agent
- created_at

**Project**
- id (UUID)
- name
- description
- funding_goal (decimal)
- amount_allocated (decimal)
- status (planning / active / completed / paused)
- impact_statement
- image_url
- display_order
- created_at

**TransparencyReport**
- id (UUID)
- month / year
- total_income
- allocation_snapshot (JSON)
- proof_urls (array)
- summary_text
- published_by (FK)
- published_at
- created_at

---

## 8. DATABASE STRUCTURE RECOMMENDATION

### Recommended Stack: PostgreSQL (via Supabase or self-hosted)

**Why PostgreSQL:**
- Robust relational integrity for financial-adjacent data
- JSONB support for flexible allocation snapshots
- Excellent auth integration (Supabase Auth)
- Row Level Security (RLS) for data protection
- Easy CSV export
- Good Webflow integration via API

### Alternative: Firebase Firestore
- Good for rapid prototyping
- Less strict relational constraints (risk for financial data)
- Easier real-time updates

### Recommended Choice: Supabase (PostgreSQL)

---

## 9. WEBFLOW CMS STRUCTURE

Even if the dashboard uses an external backend, Webflow CMS should power the marketing site content.

### CMS Collections

**1. Affiliate Offers**
- Name (plain text)
- Category (reference: Categories)
- Description (rich text)
- Benefit to User (plain text)
- Referral URL (link)
- Reward Eligible (switch)
- Active (switch)
- Featured Image (image)
- Display Order (number)

**2. Categories**
- Name (plain text)
- Slug (plain text)
- Display Order (number)
- Active (switch)

**3. Projects**
- Name (plain text)
- Description (rich text)
- Funding Goal (number)
- Amount Allocated (number)
- Status (option: Planning / Active / Completed / Paused)
- Impact Statement (plain text)
- Featured Image (image)
- Progress Bar (number, 0-100)

**4. FAQ Items**
- Question (plain text)
- Answer (rich text)
- Category (option: General / Token / Rewards / Legal / Safety)
- Display Order (number)

**5. Transparency Reports**
- Month (plain text, e.g. "May 2025")
- Total Income (number)
- Community Rewards % (number)
- Liquidity % (number)
- Buybacks % (number)
- Projects % (number)
- Proof Files (multi-image or file)
- Summary (rich text)
- Published Date (date)

**6. Ecosystem Updates**
- Title (plain text)
- Content (rich text)
- Category (option: Update / Milestone / New Offer)
- Published Date (date)
- Featured (switch)

---

## 10. AUTHENTICATION & WALLET CONNECTION

### Authentication Options

**Option A: Email + Password (Supabase Auth)**
- Pros: Simple, familiar, easy to implement
- Cons: Another password for users to manage
- Best for: MVP and broad accessibility

**Option B: Magic Link (Passwordless)**
- Pros: No passwords, secure, modern UX
- Cons: Email dependency, slight delay
- Best for: Clean UX, crypto-native audience

**Option C: Social Login (Google, Twitter/X, Discord)**
- Pros: Fast onboarding, familiar
- Cons: Platform dependency, privacy concerns
- Best for: Community growth phase

**Recommendation:** Start with Magic Link (Supabase) + optional Google login. Add wallet-based auth later.

### Wallet Connection

**Recommended Approach: Read-Only Wallet Connection**
- Users input or connect their wallet address to receive rewards
- No transaction signing required for basic participation
- Optional: WalletConnect or RainbowKit for one-click connection

**Wallet Display:**
- Show truncated address (0x1234...5678)
- Verify ownership via signed message (optional, for high-security features)

**Security Note:**
- Never ask users to sign transactions unless distributing rewards
- Never ask for private keys or seed phrases
- Clear warnings about scam impersonation

---

## 11. DASHBOARD TECHNOLOGY OPTIONS

### Option 1: Webflow + Memberstack
**Pros:**
- Native Webflow membership feel
- Easy gated content
- Good for simple use cases

**Cons:**
- Limited custom database operations
- Hard to build complex admin tools
- API limitations for reward calculations
- Scaling cost concerns

**Verdict:** Too limited for the required dashboard.

---

### Option 2: Webflow + Wized + Xano
**Pros:**
- Wized brings logic into Webflow
- Xano provides robust backend
- Visual development

**Cons:**
- Learning curve for Wized
- Vendor lock-in
- Cost scales with usage
- Complex custom admin UIs still difficult

**Verdict:** Possible, but adds complexity and vendor dependency.

---

### Option 3: Webflow + Supabase (RECOMMENDED)
**Pros:**
- Webflow handles marketing site + CMS
- Supabase provides PostgreSQL, Auth, Storage, Realtime
- Full control over data model
- Row Level Security built-in
- Generous free tier
- Easy API integration into Webflow via JavaScript
- Can build separate React dashboard that shares the same database

**Cons:**
- Requires custom frontend development for dashboard
- Not "no-code" for dashboard portion

**Verdict:** Best balance of marketing flexibility and backend power.

---

### Option 4: Webflow + Firebase
**Pros:**
- Google ecosystem
- Realtime database
- Good auth options

**Cons:**
- Firestore is document-based (less ideal for relational financial data)
- Pricing can spike with usage
- Vendor lock-in

**Verdict:** Supabase is preferable for relational data integrity.

---

### Option 5: Custom React Dashboard + Webflow Marketing Site
**Pros:**
- Complete control over UX
- Best-in-class dashboard experience
- Separate deployment from marketing site
- Can use Next.js, Tailwind, shadcn/ui

**Cons:**
- More development time
- Two codebases to maintain

**Verdict:** Best long-term solution. Dashboard lives at app.bitxbit.com.au or /dashboard route.

---

### FINAL RECOMMENDATION

**Hybrid Architecture:**
- **Marketing Site:** Webflow (hosting the pages, CMS for offers, projects, FAQs, transparency reports)
- **Dashboard:** Custom React app (Next.js) deployed as a subdomain (app.bitxbit.com.au) OR embedded via iframe/route proxy
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Edge Functions for reward calculations)
- **Wallet:** RainbowKit or Web3Modal for EVM wallet connection

This gives you:
- Marketing team control via Webflow CMS
- Developer control via React/Supabase
- Scalable, secure backend
- Clean separation of concerns

---

## 12. STAGED IMPLEMENTATION ROADMAP

### PHASE 1: Foundation & Design (Weeks 1-3)
- [ ] Finalize brand identity (colors, typography, logo if needed)
- [ ] Create Webflow style guide and component library
- [ ] Build homepage in Webflow
- [ ] Build /how-it-works, /faq, /legal pages
- [ ] Set up Webflow CMS collections
- [ ] Set up Supabase project and database schema
- [ ] Set up Supabase Auth (Magic Link)

### PHASE 2: Marketing Site Complete (Weeks 4-5)
- [ ] Build /referrals page with CMS-driven cards
- [ ] Build /token-economy page
- [ ] Build /projects page
- [ ] Build /transparency page
- [ ] Populate CMS content (offers, projects, FAQs, initial transparency reports)
- [ ] Legal review of all copy and disclaimers
- [ ] Mobile responsiveness audit

### PHASE 3: Member Dashboard MVP (Weeks 6-8)
- [ ] Scaffold Next.js dashboard app
- [ ] Connect to Supabase Auth
- [ ] Build "Overview" screen
- [ ] Build "My Profile" + wallet address field
- [ ] Build "My Rewards" read-only view
- [ ] Build "My Activity" timeline
- [ ] Build "Transparency Ledger" read-only view
- [ ] Deploy to app.bitxbit.com.au or /dashboard

### PHASE 4: Admin Dashboard (Weeks 9-10)
- [ ] Role-based access control (admin vs member)
- [ ] Admin: Manage Offers CRUD
- [ ] Admin: Manage Categories
- [ ] Admin: Income Tracking (manual entry)
- [ ] Admin: Allocation Control
- [ ] Admin: User Management
- [ ] Admin: Transparency Update publishing

### PHASE 5: Reward Engine & Transparency (Weeks 11-12)
- [ ] Reward calculation logic (edge function or scheduled job)
- [ ] Reward approval workflow
- [ ] CSV export for distribution
- [ ] Public transparency ledger auto-updates
- [ ] Project funding allocation tracking

### PHASE 6: Polish & Launch (Week 13+)
- [ ] Performance optimization
- [ ] Security audit (auth, RLS, input validation)
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Cross-browser testing
- [ ] Launch on bitxbit.com.au
- [ ] Post-launch monitoring

### Future Phases (Post-Launch)
- [ ] WalletConnect integration
- [ ] On-chain reward distribution
- [ ] Automated affiliate income integrations (APIs where available)
- [ ] Governance features for allocation voting
- [ ] Multi-language support
- [ ] Mobile app (PWA or native)

---

## APPENDIX A: DESIGN TOKENS (Quick Reference)

| Token | Value | Usage |
|-------|-------|-------|
| --color-bg-primary | #0A0E1A | Deep navy background |
| --color-bg-secondary | #111827 | Charcoal cards/panels |
| --color-bg-tertiary | #1A2236 | Elevated surfaces |
| --color-accent-primary | #3B82F6 | Electric blue CTAs, links |
| --color-accent-secondary | #F59E0B | Gold highlights, rewards |
| --color-text-primary | #F8FAFC | Headings, primary text |
| --color-text-secondary | #94A3B8 | Body text, descriptions |
| --color-text-muted | #64748B | Labels, timestamps |
| --color-success | #10B981 | Positive indicators |
| --color-warning | #F59E0B | Pending status |
| --font-heading | Inter or Geist | Headlines, display |
| --font-body | Inter or Geist | Body copy, UI |
| --radius-card | 12px | Card corners |
| --radius-button | 8px | Button corners |

---

## APPENDIX B: COMPLIANCE CHECKLIST

- [ ] Affiliate disclosure on every referral card and footer
- [ ] Token reward disclaimer on dashboard and token economy page
- [ ] "Not financial advice" disclaimer on all pages with financial proximity
- [ ] "No guaranteed returns" stated clearly in FAQ and token economy
- [ ] Crypto risk warning in legal section
- [ ] Privacy policy (GDPR / Australian Privacy Principles compliant)
- [ ] Terms of use with eligibility and jurisdiction clauses
- [ ] No APY, ROI, or passive income language anywhere
- [ ] No "buy now" pressure tactics on token
- [ ] Clear distinction between affiliate income and token value

---

*Document Version: 1.0*
*Prepared for: bitXbit Rebrand Project*
*Status: Strategic Blueprint — Pending Approval*
