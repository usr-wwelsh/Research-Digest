"""Generate an index.html page to browse all archived digests."""
import os
from datetime import datetime
import glob

def generate_index():
    archive_dir = "arxiv_archive"

    # Get all digest files
    if os.path.exists(archive_dir):
        digest_files = sorted(glob.glob(os.path.join(archive_dir, "arxiv_digest_*.html")), reverse=True)
    else:
        digest_files = []

    # Parse dates and create entries
    entries = []
    for filepath in digest_files:
        filename = os.path.basename(filepath)
        # Extract date from filename: arxiv_digest_20251101.html
        date_str = filename.replace("arxiv_digest_", "").replace(".html", "")
        try:
            date_obj = datetime.strptime(date_str, "%Y%m%d")
            formatted_date = date_obj.strftime("%B %d, %Y")
            day_of_week = date_obj.strftime("%A")
            entries.append({
                'filename': filename,
                'date': formatted_date,
                'day': day_of_week,
                'date_obj': date_obj
            })
        except ValueError:
            continue

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>arXiv Digest Archive</title>
  <style>
    * {{ box-sizing: border-box; }}

    body {{
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #e8e8e8;
      margin: 0;
      padding: 2rem;
    }}

    .container {{
      max-width: 900px;
      margin: 0 auto;
    }}

    header {{
      text-align: center;
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 2px solid #2a2a2a;
    }}

    h1 {{
      font-weight: 900;
      font-size: 2.5rem;
      margin: 0 0 0.5rem 0;
      background: linear-gradient(135deg, #ff6b6b, #ffa94d);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }}

    .subtitle {{
      color: #999;
      font-size: 1rem;
    }}

    .latest-link {{
      display: inline-block;
      background: #ff6b6b;
      color: white;
      padding: 1rem 2rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 700;
      margin-bottom: 3rem;
      transition: transform 0.2s, box-shadow 0.2s;
    }}

    .latest-link:hover {{
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(255, 107, 107, 0.3);
    }}

    .archive-list {{
      list-style: none;
      padding: 0;
    }}

    .archive-item {{
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      transition: all 0.2s;
    }}

    .archive-item:hover {{
      border-color: #ff6b6b;
      transform: translateX(5px);
    }}

    .archive-item a {{
      text-decoration: none;
      color: #e8e8e8;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}

    .date-info {{
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }}

    .date-main {{
      font-size: 1.2rem;
      font-weight: 700;
      color: #6ba3ff;
    }}

    .date-day {{
      font-size: 0.9rem;
      color: #999;
    }}

    .arrow {{
      font-size: 1.5rem;
      color: #ff6b6b;
    }}

    .no-reports {{
      text-align: center;
      color: #999;
      padding: 3rem;
    }}

    .stats {{
      text-align: center;
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid #2a2a2a;
      color: #999;
      font-size: 0.9rem;
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📚 arXiv Digest Archive</h1>
      <p class="subtitle">Browse your daily research digests</p>
    </header>

    <div style="text-align: center;">
      <a href="latest.html" class="latest-link">📰 View Latest Digest</a>
    </div>

    <h2 style="margin-bottom: 1.5rem; color: #e8e8e8;">Past Reports</h2>
"""

    if entries:
        html += '    <ul class="archive-list">\n'
        for entry in entries:
            html += f"""      <li class="archive-item">
        <a href="arxiv_archive/{entry['filename']}">
          <div class="date-info">
            <div class="date-main">{entry['date']}</div>
            <div class="date-day">{entry['day']}</div>
          </div>
          <div class="arrow">→</div>
        </a>
      </li>
"""
        html += '    </ul>\n'
    else:
        html += '    <div class="no-reports">No archived reports yet. Run the digest script to generate your first report!</div>\n'

    html += f"""
    <div class="stats">
      {len(entries)} report{"s" if len(entries) != 1 else ""} archived • Updated {datetime.now().strftime("%B %d, %Y at %I:%M %p")}
    </div>
  </div>
</body>
</html>
"""

    with open("index.html", 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"📑 Index page generated with {len(entries)} reports")

if __name__ == "__main__":
    generate_index()
