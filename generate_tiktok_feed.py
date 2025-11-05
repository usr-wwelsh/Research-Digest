import json
import random
from datetime import datetime

def interleave_papers_by_interest(all_papers_by_interest):
    """
    Interleave papers round-robin style across interests.
    Returns a flat list cycling through: Interest1[0], Interest2[0], ..., Interest1[1], Interest2[1], ...
    """
    # Shuffle papers within each interest category
    for interest_name in all_papers_by_interest:
        random.shuffle(all_papers_by_interest[interest_name])

    # Interleave round-robin
    interleaved = []
    interest_names = list(all_papers_by_interest.keys())
    max_papers = max(len(papers) for papers in all_papers_by_interest.values()) if all_papers_by_interest else 0

    for i in range(max_papers):
        for interest_name in interest_names:
            papers = all_papers_by_interest[interest_name]
            if i < len(papers):
                # Add interest category to paper data
                papers[i]['interest_category'] = interest_name
                interleaved.append(papers[i])

    return interleaved

def generate_tiktok_html(interleaved_papers):
    """Generate self-contained TikTok-style feed HTML with embedded data."""

    papers_json = json.dumps(interleaved_papers, indent=2, ensure_ascii=False)
    date_str = datetime.now().strftime('%B %d, %Y')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"/>
  <title>Research Feed • {date_str}</title>
  <style>
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    :root {{
      --bg: #000000;
      --text: #ffffff;
      --muted: #a0a0a0;
      --card-bg: #1a1a1a;
      --border: #2a2a2a;
      --accent: #ff6b6b;
      --heart-red: #ff4458;
      --layman-bg: #1f2937;
      --layman-border: #60a5fa;
    }}

    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }}

    #feed-container {{
      height: 100vh;
      overflow-y: scroll;
      scroll-snap-type: y mandatory;
      -webkit-overflow-scrolling: touch;
      padding-top: 60px; /* Space for fixed header */
    }}

    .paper-card {{
      min-height: 100vh;
      scroll-snap-align: start;
      scroll-snap-stop: always;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 2rem 1.5rem;
      position: relative;
      border-bottom: 1px solid var(--border);
    }}

    .interest-badge {{
      display: inline-block;
      background: var(--accent);
      color: white;
      padding: 0.4rem 0.9rem;
      border-radius: 20px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 1rem;
    }}

    .difficulty-badge {{
      display: inline-block;
      padding: 0.3rem 0.7rem;
      border-radius: 15px;
      font-size: 0.7rem;
      font-weight: 600;
      margin-left: 0.5rem;
    }}

    .paper-title {{
      font-size: 1.5rem;
      font-weight: 800;
      line-height: 1.3;
      margin-bottom: 1rem;
      color: var(--text);
    }}

    .layman-box {{
      background: var(--layman-bg);
      border-left: 3px solid var(--layman-border);
      padding: 1rem;
      margin-bottom: 1rem;
      border-radius: 8px;
      font-size: 0.95rem;
      line-height: 1.6;
      color: #94a3b8;
      font-style: italic;
    }}

    .summary {{
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.6;
      margin-bottom: 1.5rem;
    }}

    .paper-meta {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      color: var(--muted);
      font-size: 0.8rem;
    }}

    .category-tag {{
      background: #1e3a5f;
      color: #60a5fa;
      padding: 0.3rem 0.7rem;
      border-radius: 15px;
      font-size: 0.75rem;
      font-weight: 600;
    }}

    .links {{
      display: flex;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }}

    .links a {{
      color: #6ba3ff;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }}

    .links a:active {{
      color: var(--accent);
    }}

    /* Fixed header with export button */
    .fixed-header {{
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: rgba(0, 0, 0, 0.95);
      backdrop-filter: blur(10px);
      padding: 0.8rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      z-index: 200;
    }}

    .like-counter {{
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--muted);
      font-size: 0.9rem;
    }}

    .export-button {{
      background: linear-gradient(135deg, var(--accent), #ffa94d);
      color: white;
      border: none;
      padding: 0.6rem 1.2rem;
      border-radius: 20px;
      font-weight: 700;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s ease;
      -webkit-tap-highlight-color: transparent;
      opacity: 0.5;
      pointer-events: none;
    }}

    .export-button.active {{
      opacity: 1;
      pointer-events: auto;
    }}

    .export-button.active:active {{
      transform: scale(0.95);
    }}

    .like-button {{
      position: fixed;
      bottom: 2rem;
      right: 1.5rem;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(26, 26, 26, 0.9);
      border: 2px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.8rem;
      cursor: pointer;
      transition: all 0.2s ease;
      z-index: 100;
      -webkit-tap-highlight-color: transparent;
    }}

    .like-button:active {{
      transform: scale(0.9);
    }}

    .like-button.liked {{
      background: var(--heart-red);
      border-color: var(--heart-red);
      animation: heartbeat 0.3s ease;
    }}

    @keyframes heartbeat {{
      0%, 100% {{ transform: scale(1); }}
      50% {{ transform: scale(1.2); }}
    }}

    .scroll-indicator {{
      position: fixed;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      color: var(--muted);
      font-size: 0.8rem;
      animation: bounce 2s infinite;
      z-index: 50;
    }}

    @keyframes bounce {{
      0%, 100% {{ transform: translateX(-50%) translateY(0); }}
      50% {{ transform: translateX(-50%) translateY(-10px); }}
    }}

    .hide-indicator {{
      display: none;
    }}
  </style>
</head>
<body>
  <!-- Fixed Header with Export Button -->
  <div class="fixed-header">
    <div class="like-counter">
      <span>♥</span>
      <span><span id="likeCount">0</span> liked</span>
    </div>
    <button class="export-button" id="exportButton">Export Likes</button>
  </div>

  <div id="feed-container"></div>

  <div class="like-button" id="likeButton">
    <span id="heartIcon">♡</span>
  </div>

  <div class="scroll-indicator" id="scrollIndicator">
    ↓ Scroll to explore
  </div>

  <script>
    // ============================================
    // EMBEDDED PAPERS DATA
    // ============================================
    const papers = {papers_json};

    // ============================================
    // STATE MANAGEMENT
    // ============================================
    let likes = JSON.parse(localStorage.getItem('tiktok_likes') || '{{}}');
    let currentPaperIndex = 0;

    // ============================================
    // RENDER FEED
    // ============================================
    function renderFeed() {{
      const container = document.getElementById('feed-container');

      papers.forEach((paper, index) => {{
        const card = document.createElement('div');
        card.className = 'paper-card';
        card.dataset.index = index;

        card.innerHTML = `
          <div class="interest-badge">${{paper.interest_category}}</div>
          <div class="difficulty-badge">${{paper.difficulty}}</div>

          <h1 class="paper-title">${{paper.title}}</h1>

          <div class="layman-box">💡 ${{paper.layman}}</div>

          <div class="summary">${{paper.summary}}</div>

          <div class="paper-meta">
            <span class="category-tag">${{paper.category}}</span>
            <span class="date">${{paper.published}}</span>
          </div>

          <div class="links">
            <a href="${{paper.link}}" target="_blank">Abstract ↗</a>
            <a href="${{paper.pdf_link}}" target="_blank">PDF ↗</a>
          </div>
        `;

        container.appendChild(card);
      }});
    }}

    // ============================================
    // LIKE SYSTEM
    // ============================================
    function getCurrentPaper() {{
      const container = document.getElementById('feed-container');
      const scrollPos = container.scrollTop;
      const windowHeight = window.innerHeight;

      // Find which paper is currently in view
      const cards = document.querySelectorAll('.paper-card');
      for (let i = 0; i < cards.length; i++) {{
        const rect = cards[i].getBoundingClientRect();
        if (rect.top >= -windowHeight/2 && rect.top < windowHeight/2) {{
          return i;
        }}
      }}
      return 0;
    }}

    function toggleLike() {{
      const paperIndex = getCurrentPaper();
      const paper = papers[paperIndex];
      const arxivId = paper.arxiv_id;

      const heartIcon = document.getElementById('heartIcon');
      const likeButton = document.getElementById('likeButton');

      if (likes[arxivId]) {{
        // Unlike
        delete likes[arxivId];
        heartIcon.textContent = '♡';
        likeButton.classList.remove('liked');
      }} else {{
        // Like
        likes[arxivId] = {{
          arxiv_id: arxivId,
          title: paper.title,
          abstract_url: paper.link,
          category: paper.category,
          interest_category: paper.interest_category,
          liked_date: new Date().toISOString(),
          difficulty: paper.difficulty
        }};
        heartIcon.textContent = '♥';
        likeButton.classList.add('liked');
      }}

      // Save to localStorage
      localStorage.setItem('tiktok_likes', JSON.stringify(likes));

      // Update counter and export button
      updateCounter();
      updateExportButton();
    }}

    function updateLikeButton() {{
      const paperIndex = getCurrentPaper();
      const paper = papers[paperIndex];
      const heartIcon = document.getElementById('heartIcon');
      const likeButton = document.getElementById('likeButton');

      if (likes[paper.arxiv_id]) {{
        heartIcon.textContent = '♥';
        likeButton.classList.add('liked');
      }} else {{
        heartIcon.textContent = '♡';
        likeButton.classList.remove('liked');
      }}
    }}

    function updateCounter() {{
      const count = Object.keys(likes).length;
      document.getElementById('likeCount').textContent = count;
    }}

    function updateExportButton() {{
      const exportButton = document.getElementById('exportButton');
      if (Object.keys(likes).length > 0) {{
        exportButton.classList.add('active');
      }} else {{
        exportButton.classList.remove('active');
      }}
    }}

    // ============================================
    // EXPORT LIKES
    // ============================================
    function exportLikes() {{
      const likedPapers = Object.values(likes);

      // Calculate category preferences
      const preferences = {{}};
      likedPapers.forEach(paper => {{
        const cat = paper.interest_category;
        preferences[cat] = (preferences[cat] || 0) + 1;
      }});

      const exportData = {{
        liked_papers: likedPapers,
        preferences: preferences,
        export_date: new Date().toISOString(),
        total_likes: likedPapers.length
      }};

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {{
        type: 'application/json'
      }});

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arxiv_likes_${{new Date().toISOString().split('T')[0]}}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }}

    // ============================================
    // EVENT LISTENERS
    // ============================================
    document.getElementById('likeButton').addEventListener('click', toggleLike);
    document.getElementById('exportButton').addEventListener('click', exportLikes);

    // Update like button when scrolling
    document.getElementById('feed-container').addEventListener('scroll', () => {{
      updateLikeButton();

      // Hide scroll indicator after first scroll
      const scrollIndicator = document.getElementById('scrollIndicator');
      if (document.getElementById('feed-container').scrollTop > 50) {{
        scrollIndicator.classList.add('hide-indicator');
      }}
    }});

    // ============================================
    // INITIALIZATION
    // ============================================
    renderFeed();
    updateLikeButton();
    updateCounter();
    updateExportButton();
  </script>
</body>
</html>
"""

    return html

def save_tiktok_feed(all_papers_by_interest, filename='tiktok_feed.html'):
    """
    Generate and save TikTok-style feed from papers data.
    Called by main.py after fetching papers.
    """
    # Interleave papers round-robin
    interleaved = interleave_papers_by_interest(all_papers_by_interest)
    print(f"\n🔄 Interleaved {len(interleaved)} papers across {len(all_papers_by_interest)} interests")

    # Generate HTML
    html = generate_tiktok_html(interleaved)

    # Save file
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"✨ TikTok feed saved to {filename}")
    print("📱 Sync with your phone and open in browser!")
