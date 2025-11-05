# 📱 Syncthing + Daily arXiv Digest Setup Guide

## 🎯 What This Does
- Automatically runs your arXiv digest **every morning at 7 AM**
- Archives each day's report in `arxiv_archive/`
- Creates `latest.html` for quick access
- Generates `index.html` to browse all past reports
- Syncs everything to your phone via Syncthing

---

## ⚙️ Step 1: Set Up Windows Task Scheduler

### Option A: Quick Setup (Copy-Paste This)
1. Press `Win + R`, type `taskschd.msc`, press Enter
2. Click **"Create Basic Task"** in the right panel
3. Fill in:
   - **Name:** `Research Digest Daily`
   - **Description:** `Fetches daily research papers and syncs to phone`
4. **Trigger:** Select "Daily"
   - Start date: Today
   - Start time: **7:00 AM**
   - Recur every: **1 days**
5. **Action:** Select "Start a program"
   - **Program/script:** Browse to your `run_digest.bat` file
   - **Start in:** The folder containing the project (e.g., `C:\Users\YourName\research-digest`)
6. Check **"Open the Properties dialog"** at the end
7. In Properties:
   - Go to **Conditions** tab
   - ✅ Check "Start only if the following network connection is available" → Select "Any connection"
   - ❌ Uncheck "Start the task only if the computer is on AC power"
8. Click **OK**

### Option B: Advanced Settings
If you want to run it at startup instead:
- Change Trigger to **"At log on"**
- Add a 2-minute delay: In Properties → Triggers → Edit → Delay task for: **2 minutes**

---

## 📂 Step 2: Set Up Syncthing

### On Your PC:
1. Open Syncthing web UI (usually `http://localhost:8384`)
2. Click **"Add Folder"**
   - **Folder Path:** Your project directory (e.g., `C:\Users\YourName\research-digest`)
   - **Folder Label:** `Research Digest`
   - **Folder ID:** `research-digest` (auto-generated)
3. Go to **"Sharing"** tab
4. Click **"Add Device"** and enter your phone's Device ID

### On Your Phone:
1. Install **Syncthing** from Play Store / App Store
2. Open app → **Add Device** → Scan QR code from PC
3. Accept the folder share request (`Research Digest`)
4. Set sync folder location (e.g., `/storage/emulated/0/ResearchDigest/`)

### What Gets Synced:
```
research-digest/
├── latest.html          ← Most recent digest (quick access)
├── index.html           ← Browse all reports
├── tiktok_feed.html     ← Mobile-optimized feed
└── arxiv_archive/
    ├── arxiv_digest_20251101.html
    ├── arxiv_digest_20251102.html
    └── ... (daily backups)
```

---

## 📱 Step 3: View on Your Phone

### Method 1: Direct File Access
1. Open your phone's file manager
2. Navigate to the Syncthing folder (e.g., `ResearchDigest/`)
3. Open `latest.html` with any browser for desktop view
4. Open `tiktok_feed.html` for mobile-optimized scrolling
5. Open `index.html` to browse past reports

### Method 2: Use a Local HTML Viewer App
Install **"HTML Viewer"** or **"WebView Tester"** from the app store:
- Point it to your Syncthing folder
- Bookmark `latest.html` for instant access

### Method 3: Create a Home Screen Shortcut (Android)
1. Open `tiktok_feed.html` in Chrome (for mobile view)
2. Menu → **"Add to Home screen"**
3. Name it "Research Digest"
4. Now you have one-tap access!

---

## 🧪 Testing Your Setup

### Test the Batch Script:
```batch
# Double-click run_digest.bat or run in Command Prompt:
cd path\to\research-digest
run_digest.bat
```

Expected output:
```
Running arXiv digest...
🔍 Fetching papers for: Efficient ML / Edge AI
   → Found 5 papers
...
✨ HTML digest saved to arxiv_archive\arxiv_digest_20251101.html
📄 Latest digest saved to latest.html

Generating index page...
📑 Index page generated with 1 reports
Done! All files updated.
```

### Test Syncthing Sync:
1. Create/edit any file in your project directory
2. Check your phone's Syncthing folder
3. File should appear within seconds

### Test Task Scheduler:
1. Open Task Scheduler
2. Find "Research Digest Daily"
3. Right-click → **"Run"**
4. Watch it execute

---

## 🎨 Customization Ideas

### Change Run Time:
Edit the Task Scheduler trigger to your preferred time (e.g., 6 AM, 9 PM)

### Change Number of Papers:
Edit `config.json` settings:
```json
{
  "settings": {
    "papers_per_interest": 15
  }
}
```

### Add More Interest Areas:
Edit `config.json` and add your topics:
```json
{
  "interests": {
    "Your Research Area": {
      "query": "cat:cs.AI OR cat:cs.LG",
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  }
}
```

### Sync Only HTML Files (Save Space):
In Syncthing → Folder → **Ignore Patterns**, add:
```
!/arxiv_archive/*.html
!/latest.html
!/index.html
*
```

---

## 🔧 Troubleshooting

### Task Scheduler doesn't run:
- Check Windows Event Viewer: `Win + X` → Event Viewer → Task Scheduler logs
- Ensure "Run whether user is logged on or not" is selected
- Make sure network connection is available

### Syncthing not syncing:
- Check both devices are connected to the same network (or internet)
- Verify Device IDs match
- Check folder status in Syncthing UI (should say "Up to Date")

### Python script fails:
- Test manually: Navigate to project folder, run `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Linux/macOS), then `python main.py`
- Check arXiv API rate limits (3-second delays are built in)
- Ensure internet connection is active

### Old reports taking up space:
Create a cleanup script to delete reports older than 30 days:
```python
# cleanup_old.py
import os, glob, time
for f in glob.glob("arxiv_archive/*.html"):
    if os.path.getmtime(f) < time.time() - 30*86400:
        os.remove(f)
```

---

## 🎉 You're All Set!

Every morning at 7 AM:
1. ✅ Script fetches latest papers
2. ✅ Generates beautiful HTML report
3. ✅ Archives it with date
4. ✅ Updates index page
5. ✅ Syncs to your phone
6. ✅ Read cutting-edge research over coffee!

**Enjoy your automated research digest! 🚀**
