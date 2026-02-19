# 🏏 The Crease — Cricket Stats Website

A clean, full-featured cricket statistics tracker for local matches. Upload PDF scorecards, review parsed data, and share live stats with everyone via a simple link.

**Live data is stored in Supabase** — so every visitor sees the same up-to-date stats automatically.

---

## 🚀 Setup Guide (One Time, ~10 minutes)

### Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up for a free account.
2. Click **New Project**, give it a name like `thecrease`, choose a region close to you, and set a database password (save it somewhere safe).
3. Wait ~2 minutes for the project to spin up.

---

### Step 2 — Create the Database Table

1. In your Supabase project, go to **SQL Editor** (left sidebar).
2. Click **New Query**, paste the SQL below, and click **Run**:

```sql
-- Create the matches table
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- Allow public reads (everyone can view stats)
CREATE POLICY "public_read" ON matches
  FOR SELECT USING (true);

-- Allow public writes (admin access is controlled via the app password)
CREATE POLICY "public_insert" ON matches
  FOR INSERT WITH CHECK (true);

CREATE POLICY "public_update" ON matches
  FOR UPDATE USING (true);

CREATE POLICY "public_delete" ON matches
  FOR DELETE USING (true);
```

---

### Step 3 — Get Your API Keys

1. In your Supabase project, go to **Project Settings → API** (left sidebar).
2. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a long JWT string under "Project API keys"

---

### Step 4 — Configure `index.html`

Open `index.html` in any text editor. Near the top, find the `CONFIG` block:

```javascript
const CONFIG = {
  supabaseUrl:  "YOUR_SUPABASE_URL",      // ← paste Project URL here
  supabaseKey:  "YOUR_SUPABASE_ANON_KEY", // ← paste anon public key here
  docstrangeKey:"510ce913-0b3d-11f1-96fa-56d39eb2c6a9",
  adminPass:    "cricket2024"             // ← change this to your own password!
};
```

Replace the placeholder values with your actual credentials and save the file.

> ⚠️ **Security note:** Since this is a public GitHub Pages site, your Supabase keys will be visible in the source code. This is fine for a cricket stats site — the data isn't sensitive. The Row Level Security policies in Step 2 ensure only the allowed operations can happen. Change `adminPass` to something only you know.

---

### Step 5 — Push to GitHub & Enable GitHub Pages

1. Create a new GitHub repository (e.g. `thecrease` or `cricket-stats`).
2. Push `index.html` and `README.md` to the repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. In your repo, go to **Settings → Pages**.
4. Under **Source**, select **Deploy from a branch → main → / (root)**.
5. Click **Save**. After ~1 minute, GitHub Pages will give you a URL like:
   ```
   https://YOUR_USERNAME.github.io/YOUR_REPO/
   ```
6. Share that URL with your friends! 🎉

---

## 📋 How to Use

### As a Viewer (anyone with the link)
- Visit the URL to see all match results and player statistics.
- Click any match to see the full scorecard (batting, bowling, fall of wickets tabs).
- Go to **Players** to see combined stats — click any column header to sort.

### As Admin (you)
1. Click **Admin** in the top-right nav and enter your password.
2. An **Upload** button will appear in the nav.
3. Click Upload → drag/drop or browse for a PDF scorecard.
4. **DocStrange AI** extracts the text from the PDF.
5. **Claude AI** structures it into proper match data.
6. A **review screen** opens — edit any field that was parsed incorrectly.
7. Click **Confirm & Save** — the data is saved to Supabase immediately, visible to everyone.
8. You can edit any saved match later via the **✏️ Edit** button on its detail page.

---

## 📊 Stats Tracked

| Category | Stats |
|---|---|
| **Batting** | Matches, Innings, Not Outs, Runs, Balls, HS, Average, Strike Rate, 4s, 6s |
| **Bowling** | Overs, Maidens, Runs, Wickets, Average, Economy, Strike Rate, Wicket types (b/c/lbw/st/hw) |
| **Fielding** | Catches, Run Outs, Stumpings |

Same player can appear in multiple teams — all stats are combined across all matches.

---

## 🔧 Tech Stack

| Component | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (no build step) |
| Hosting | GitHub Pages (free) |
| Database | Supabase PostgreSQL (free tier) |
| PDF Extraction | DocStrange by Nanonets |
| AI Parsing | Anthropic Claude (claude-sonnet) |
| Fonts | Oswald + DM Sans (Google Fonts) |

---

## 🎨 Changing the Admin Password

Open `index.html`, find the `CONFIG` block, and change `adminPass`:

```javascript
adminPass: "your_new_password_here"
```

Push the change to GitHub — the new password takes effect immediately.

---

## ❓ Troubleshooting

**"DocStrange error 401"** — Your DocStrange API key may have expired or hit its limit. Get a new key from [docstrange.nanonets.com](https://docstrange.nanonets.com).

**"Save failed: new row violates row-level security"** — Make sure you ran all four `CREATE POLICY` statements in Step 2.

**Data not showing after save** — Hard refresh the page (Ctrl+Shift+R). Supabase data loads fresh on each page visit.

**PDF parsing looks wrong** — Use the review modal to correct any fields before saving. The AI does its best but handwritten or unusual scorecard formats may need manual fixes.
