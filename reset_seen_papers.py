"""
Reset the seen_papers.json file to start fresh.
Run this if you want to see papers again that were previously shown.
"""
import os
import json

SEEN_PAPERS_FILE = "seen_papers.json"

if os.path.exists(SEEN_PAPERS_FILE):
    # Backup old file
    backup_file = SEEN_PAPERS_FILE.replace('.json', '_backup.json')
    os.rename(SEEN_PAPERS_FILE, backup_file)
    print(f"✅ Backed up old file to {backup_file}")
    print(f"✅ Reset complete! Next run will show all papers as fresh.")
else:
    print("ℹ️ No seen_papers.json file found. Nothing to reset.")
