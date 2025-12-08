import os
import time
import json
import xml.etree.ElementTree as ET
import requests
from transformers import pipeline
from datetime import datetime, timedelta
from generate_tiktok_feed import save_tiktok_feed

# ======================
# CONFIGURATION
# ======================

def load_config():
    """Load configuration from config.json file."""
    config_file = "config.json"

    # Default configuration (fallback)
    default_config = {
        "interests": {
            "Efficient ML / Edge AI": {
                "query": 'cat:cs.LG OR cat:cs.CV OR cat:cs.CL',
                "keywords": ['efficient', 'edge', 'compression', 'quantization', 'pruning', 'distillation', 'inference', 'lightweight', 'mobile', 'accelerat']
            }
        },
        "settings": {
            "papers_per_interest": 10,
            "summary_max_length": 160,
            "recent_days": 7,
            "fallback_days": 90,
            "min_papers_threshold": 5,
            "fetch_multiplier": 5,
            "user_agent": "ResearchDigestBot/1.0 (github.com/usr-wwelsh)"
        }
    }

    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
                print(f"✅ Loaded configuration from {config_file}")
                return config
        except Exception as e:
            print(f"⚠️ Error loading config file: {e}. Using defaults.")
            return default_config
    else:
        print(f"⚠️ {config_file} not found. Using default configuration.")
        return default_config

# Load configuration
config = load_config()
INTERESTS = config.get('interests', {})
settings = config.get('settings', {})

PAPERS_PER_INTEREST = settings.get('papers_per_interest', 10)
SUMMARY_MAX_LENGTH = settings.get('summary_max_length', 160)
USER_AGENT = settings.get('user_agent', 'ResearchDigestBot/1.0')

# Date filtering: Only fetch papers from the last N days (set to 0 to disable)
RECENT_DAYS = settings.get('recent_days', 7)
FALLBACK_DAYS = settings.get('fallback_days', 90)
MIN_PAPERS_THRESHOLD = settings.get('min_papers_threshold', 5)
FETCH_MULTIPLIER = settings.get('fetch_multiplier', 5)

# Deduplication: Track papers we've already shown
SEEN_PAPERS_FILE = "seen_papers.json"

# Initialize summarizer (optional)
try:
    summarizer = pipeline(
        "summarization",
        model="sshleifer/distilbart-cnn-12-6",
        device=-1
    )
except Exception as e:
    print(f"⚠️ Summarizer unavailable ({e}). Using raw abstracts.")
    summarizer = None

# ======================
# DEDUPLICATION HELPERS
# ======================

def load_seen_papers():
    """Load the set of previously seen paper IDs."""
    if os.path.exists(SEEN_PAPERS_FILE):
        try:
            with open(SEEN_PAPERS_FILE, 'r') as f:
                data = json.load(f)
                return set(data.get('seen_ids', []))
        except Exception as e:
            print(f"⚠️ Error loading seen papers: {e}")
    return set()

def save_seen_papers(seen_ids):
    """Save the set of seen paper IDs."""
    try:
        with open(SEEN_PAPERS_FILE, 'w') as f:
            json.dump({
                'seen_ids': list(seen_ids),
                'last_updated': datetime.now().isoformat()
            }, f, indent=2)
    except Exception as e:
        print(f"⚠️ Error saving seen papers: {e}")

def get_date_filter(days=None):
    """Generate date filter for arXiv query (last N days)."""
    if days is None:
        days = RECENT_DAYS

    if days <= 0:
        return ""

    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)

    # arXiv date format: YYYYMMDD0000 to YYYYMMDD2359
    date_filter = f"submittedDate:[{start_date.strftime('%Y%m%d')}0000 TO {end_date.strftime('%Y%m%d')}2359]"
    return date_filter

# ======================
# ARXIV FETCH & PARSE
# ======================

def fetch_arxiv_papers(query, max_results=5, days_back=None):
    url = "http://export.arxiv.org/api/query"

    # Add date filter if configured
    date_filter = get_date_filter(days_back)
    if date_filter:
        # Combine user query with date filter using AND
        query = f"({query}) AND {date_filter}"

    params = {
        "search_query": query,
        "start": 0,
        "max_results": max_results,
        "sortBy": "submittedDate",
        "sortOrder": "descending"
    }
    headers = {"User-Agent": USER_AGENT}
    try:
        response = requests.get(url, params=params, headers=headers, timeout=20)
        response.raise_for_status()
        return response.text
    except Exception as e:
        print(f"❌ Error fetching query '{query}': {e}")
        return None

def parse_papers(xml_data):
    if not xml_data:
        return []
    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError:
        return []

    namespace = {'atom': 'http://www.w3.org/2005/Atom'}
    papers = []

    for entry in root.findall('atom:entry', namespace):
        title_elem = entry.find('atom:title', namespace)
        summary_elem = entry.find('atom:summary', namespace)
        id_elem = entry.find('atom:id', namespace)
        published_elem = entry.find('atom:published', namespace)

        if None in (title_elem, summary_elem, id_elem):
            continue

        title = ' '.join(title_elem.text.strip().split())
        summary = ' '.join(summary_elem.text.strip().split())
        link = id_elem.text
        published = published_elem.text.split('T')[0] if published_elem is not None else "Unknown"

        # Extract arXiv ID
        arxiv_id = link.split('/abs/')[-1].split('v')[0]

        # Get primary category
        primary_cat_elem = entry.find('.//{http://arxiv.org/schemas/atom}primary_category')
        category = primary_cat_elem.get('term') if primary_cat_elem is not None else "unknown"

        papers.append({
            'title': title,
            'summary': summary,
            'link': link,
            'pdf_link': f"https://arxiv.org/pdf/{arxiv_id}.pdf",
            'arxiv_id': arxiv_id,
            'category': category,
            'published': published
        })
    return papers

def summarize_abstract(abstract):
    if summarizer is None:
        return abstract[:SUMMARY_MAX_LENGTH] + ("..." if len(abstract) > SUMMARY_MAX_LENGTH else "")
    try:
        if len(abstract.split()) < 15:
            return abstract
        result = summarizer(
            abstract,
            max_length=min(SUMMARY_MAX_LENGTH, 142),
            min_length=30,
            truncation=True
        )
        return result[0]['summary_text']
    except Exception as e:
        return abstract[:SUMMARY_MAX_LENGTH] + "..."

def calculate_relevance_score(paper, keywords):
    """Calculate relevance score based on keyword matches in title and abstract."""
    title_lower = paper['title'].lower()
    abstract_lower = paper['summary'].lower()

    score = 0
    matched_keywords = []

    for keyword in keywords:
        keyword_lower = keyword.lower()
        # Title matches are worth more
        if keyword_lower in title_lower:
            score += 3
            matched_keywords.append(keyword)
        # Abstract matches
        elif keyword_lower in abstract_lower:
            score += 1
            matched_keywords.append(keyword)

    # Bonus for multiple keyword matches
    if len(matched_keywords) > 2:
        score += len(matched_keywords) - 2

    paper['relevance_score'] = score
    paper['matched_keywords'] = matched_keywords
    return score

def estimate_difficulty(abstract, category):
    """Estimate paper difficulty using heuristic keyword analysis."""
    abstract_lower = abstract.lower()

    # Theory-heavy indicators
    complexity_words = ['theoretical', 'proof', 'theorem', 'convergence', 'optimal',
                        'asymptotic', 'lemma', 'proposition', 'rigorous', 'formalism']

    # Applied/practical indicators
    applied_words = ['system', 'framework', 'application', 'dataset', 'benchmark',
                     'implementation', 'experiment', 'empirical', 'practical']

    # Math-heavy categories
    math_categories = ['math.', 'stat.', 'quant-ph']

    # Calculate score
    score = sum(1 for w in complexity_words if w in abstract_lower)
    score -= sum(0.5 for w in applied_words if w in abstract_lower)

    # Category bonus
    if any(cat in category for cat in math_categories):
        score += 1

    # Determine difficulty level
    if score > 2:
        return "🔴 Theory-Heavy"
    elif score > 0.5:
        return "🟡 Advanced"
    else:
        return "🟢 Applied"

def generate_layman_context(title, abstract):
    """Generate simple layman explanation using keyword extraction and templates."""
    abstract_lower = abstract.lower()

    # Extract key action words and concepts
    action_map = {
        'improv': 'improves',
        'reduc': 'reduces',
        'enhanc': 'enhances',
        'optimi': 'optimizes',
        'acceler': 'speeds up',
        'efficient': 'makes more efficient',
        'novel': 'introduces a new approach to',
        'outperform': 'works better than existing methods for',
        'achiev': 'achieves better',
        'propose': 'proposes a method for',
        'present': 'presents techniques for',
        'address': 'tackles the problem of',
        'privacy': 'protecting data privacy in',
        'federated': 'distributed machine learning across',
        'emotion': 'understanding emotions in',
        'embedded': 'running AI on low-power devices for',
        'edge': 'running AI locally on devices for',
        'compression': 'making models smaller for',
        'inference': 'faster predictions in',
        'generative': 'creating new content with',
        'detection': 'automatically finding',
        'classification': 'categorizing',
        'prediction': 'forecasting'
    }

    # Find first matching action
    action = "explores techniques in"
    for keyword, phrase in action_map.items():
        if keyword in abstract_lower[:300]:  # Check first part of abstract
            action = phrase
            break

    # Extract domain
    domain = "machine learning"
    if "language model" in abstract_lower or "llm" in abstract_lower or "nlp" in abstract_lower:
        domain = "language AI"
    elif "vision" in abstract_lower or "image" in abstract_lower or "visual" in abstract_lower:
        domain = "computer vision"
    elif "speech" in abstract_lower or "audio" in abstract_lower:
        domain = "speech processing"
    elif "privacy" in abstract_lower or "federated" in abstract_lower:
        domain = "privacy-preserving AI"
    elif "edge" in abstract_lower or "embedded" in abstract_lower or "device" in abstract_lower:
        domain = "edge computing"
    elif "emotion" in abstract_lower or "affective" in abstract_lower:
        domain = "emotion AI"

    return f"This research {action} {domain}."

# ======================
# HTML OUTPUT
# ======================

def save_html_digest(all_papers_by_interest, filename=None):
    # Create archive directory if it doesn't exist
    archive_dir = "arxiv_archive"
    if not os.path.exists(archive_dir):
        os.makedirs(archive_dir)

    if filename is None:
        date_str = datetime.now().strftime('%Y%m%d')
        filename = os.path.join(archive_dir, f"arxiv_digest_{date_str}.html")

    # Also save as latest.html for easy syncing
    latest_file = "latest.html"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>arXiv Digest • {datetime.now().strftime('%Y-%m-%d')}</title>
  <style>
    * {{ box-sizing: border-box; }}

    :root {{
      --bg: #0f0f0f;
      --text: #e8e8e8;
      --muted: #999;
      --border: #2a2a2a;
      --card-bg: #1a1a1a;
      --link: #6ba3ff;
      --accent: #ff6b6b;
      --green: #51cf66;
      --yellow: #ffd43b;
      --red: #ff6b6b;
      --layman-bg: #1f2937;
      --layman-border: #60a5fa;
    }}

    body {{
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.5;
      color: var(--text);
      background: var(--bg);
      margin: 0;
      padding: 1rem;
    }}

    .container {{
      max-width: 1600px;
      margin: 0 auto;
    }}

    header {{
      text-align: center;
      padding: 2rem 1rem 3rem;
      border-bottom: 2px solid var(--border);
      margin-bottom: 2rem;
    }}

    h1 {{
      font-weight: 900;
      font-size: 2.5rem;
      margin: 0;
      background: linear-gradient(135deg, var(--accent), #ffa94d);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }}

    .meta {{
      color: var(--muted);
      font-size: 0.95rem;
      margin-top: 0.5rem;
      letter-spacing: 0.5px;
    }}

    .interest-section {{
      margin-bottom: 3rem;
    }}

    .interest-header {{
      display: flex;
      align-items: center;
      gap: 0.8rem;
      margin-bottom: 1.2rem;
      padding: 0.8rem 1rem;
      background: var(--card-bg);
      border-radius: 12px;
      border-left: 4px solid var(--accent);
    }}

    .interest-title {{
      font-size: 1.3rem;
      margin: 0;
      font-weight: 700;
      color: var(--text);
    }}

    .papers-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 1.2rem;
    }}

    .paper {{
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.2rem;
      transition: all 0.2s ease;
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
    }}

    .paper:hover {{
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(255, 107, 107, 0.15);
    }}

    .paper-header {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 0.8rem;
      margin-bottom: 0.8rem;
    }}

    .difficulty-badge {{
      padding: 0.3rem 0.7rem;
      border-radius: 20px;
      font-size: 0.7rem;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
    }}

    .paper h3 {{
      font-size: 1.05rem;
      margin: 0 0 0.8rem 0;
      font-weight: 700;
      line-height: 1.4;
      color: var(--text);
    }}

    .layman-box {{
      background: var(--layman-bg);
      border-left: 3px solid var(--layman-border);
      padding: 0.7rem 0.9rem;
      margin-bottom: 0.8rem;
      border-radius: 6px;
      font-size: 0.88rem;
      line-height: 1.5;
      color: #94a3b8;
      font-style: italic;
    }}

    .summary {{
      color: var(--muted);
      margin-bottom: 1rem;
      font-size: 0.88rem;
      line-height: 1.6;
      flex-grow: 1;
    }}

    .paper-footer {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 0.8rem;
      border-top: 1px solid var(--border);
      margin-top: auto;
    }}

    .category-tag {{
      background: #1e3a5f;
      color: #60a5fa;
      padding: 0.25rem 0.65rem;
      border-radius: 15px;
      font-size: 0.75rem;
      font-weight: 600;
    }}

    .date {{
      color: var(--muted);
      font-size: 0.75rem;
    }}

    .links {{
      display: flex;
      gap: 1rem;
      margin-top: 0.8rem;
    }}

    .links a {{
      color: var(--link);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 600;
      transition: color 0.2s;
    }}

    .links a:hover {{
      color: var(--accent);
    }}

    .footer {{
      text-align: center;
      margin-top: 4rem;
      padding: 2rem;
      color: var(--muted);
      font-size: 0.85rem;
      border-top: 1px solid var(--border);
    }}

    @media (max-width: 768px) {{
      .papers-grid {{
        grid-template-columns: 1fr;
      }}
      h1 {{
        font-size: 2rem;
      }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>arXiv Research Digest</h1>
      <div class="meta">{datetime.now().strftime('%B %d, %Y')} • {sum(len(p) for p in all_papers_by_interest.values())} papers across {len(all_papers_by_interest)} interests</div>
    </header>
"""

    for interest_name, papers in all_papers_by_interest.items():
        html += f"""<section class="interest-section">
  <div class="interest-header">
    <span>🔬</span>
    <h2 class="interest-title">{interest_name}</h2>
  </div>
"""
        if not papers:
            html += '  <p>No recent papers found.</p>\n'
        else:
            html += '  <div class="papers-grid">\n'
            for paper in papers:
                html += f"""    <article class="paper">
      <div class="paper-header">
        <span class="difficulty-badge">{paper['difficulty']}</span>
      </div>
      <h3>{paper['title']}</h3>
      <div class="layman-box">💡 {paper['layman']}</div>
      <div class="summary">{paper['summary']}</div>
      <div class="paper-footer">
        <span class="category-tag">{paper['category']}</span>
        <span class="date">{paper['published']}</span>
      </div>
      <div class="links">
        <a href="{paper['link']}" target="_blank">Abstract ↗</a>
        <a href="{paper['pdf_link']}" target="_blank">PDF ↗</a>
      </div>
    </article>
"""
            html += '  </div>\n'
        html += "</section>\n"

    html += """    <div class="footer">
      ✨ Generated automatically • Powered by arXiv API
    </div>
  </div>
</body>
</html>
"""
    # Save archived version
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"✨ HTML digest saved to {filename}")

    # Also save as latest.html for quick access
    with open(latest_file, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"📄 Latest digest saved to {latest_file}")

# ======================
# MAIN EXECUTION
# ======================

if __name__ == "__main__":
    # Load previously seen papers
    seen_papers = load_seen_papers()
    print(f"📋 Loaded {len(seen_papers)} previously seen papers")

    if RECENT_DAYS > 0:
        print(f"📅 Fetching papers from last {RECENT_DAYS} days")
    else:
        print("📅 Fetching all available papers (no date filter)")

    all_papers = {}
    new_papers_count = 0
    duplicate_count = 0

    for interest_name, interest_config in INTERESTS.items():
        query = interest_config['query']
        keywords = interest_config['keywords']

        print(f"\n🔍 Fetching papers for: {interest_name}")
        xml_data = fetch_arxiv_papers(query, PAPERS_PER_INTEREST * FETCH_MULTIPLIER)  # Fetch more to filter
        papers = parse_papers(xml_data) if xml_data else []

        print(f"   → Found {len(papers)} papers")

        # Filter out duplicates and calculate relevance
        fresh_papers = []
        for p in papers:
            if p['arxiv_id'] not in seen_papers:
                # Store original abstract for analysis
                original_abstract = p['summary']

                # Calculate relevance score FIRST (before summarization)
                calculate_relevance_score(p, keywords)

                # Estimate difficulty level (use ORIGINAL abstract before summarization)
                p['difficulty'] = estimate_difficulty(original_abstract, p['category'])

                # Generate layman context (use ORIGINAL abstract for better keyword extraction)
                p['layman'] = generate_layman_context(p['title'], original_abstract)

                # Generate summary (do this last to avoid losing original abstract)
                p['summary'] = summarize_abstract(original_abstract)

                fresh_papers.append(p)
            else:
                duplicate_count += 1

        # Sort by relevance score (highest first)
        fresh_papers.sort(key=lambda x: x['relevance_score'], reverse=True)

        # Take top N papers
        top_papers = fresh_papers[:PAPERS_PER_INTEREST]

        # Mark these papers as seen
        for p in top_papers:
            seen_papers.add(p['arxiv_id'])
            new_papers_count += 1

        all_papers[interest_name] = top_papers
        print(f"   ✨ {len(top_papers)} new papers (from {len(fresh_papers)} candidates, skipped {len(papers) - len(fresh_papers)} duplicates)")
        if top_papers:
            print(f"   📊 Relevance scores: {[p['relevance_score'] for p in top_papers]}")

        # FALLBACK: If we didn't get enough papers, try wider date range (only 1 extra request)
        if len(top_papers) < MIN_PAPERS_THRESHOLD and FALLBACK_DAYS > RECENT_DAYS:
            print(f"   🔄 Low yield, trying fallback search (last {FALLBACK_DAYS} days)...")
            time.sleep(5)  # Respect rate limit before fallback request

            xml_data_fallback = fetch_arxiv_papers(query, PAPERS_PER_INTEREST * FETCH_MULTIPLIER, days_back=FALLBACK_DAYS)
            papers_fallback = parse_papers(xml_data_fallback) if xml_data_fallback else []

            print(f"   → Found {len(papers_fallback)} papers in fallback")

            # Process fallback papers
            fallback_fresh = []
            for p in papers_fallback:
                if p['arxiv_id'] not in seen_papers:
                    original_abstract = p['summary']
                    calculate_relevance_score(p, keywords)
                    p['difficulty'] = estimate_difficulty(original_abstract, p['category'])
                    p['layman'] = generate_layman_context(p['title'], original_abstract)
                    p['summary'] = summarize_abstract(original_abstract)
                    fallback_fresh.append(p)

            # Sort fallback papers by relevance
            fallback_fresh.sort(key=lambda x: x['relevance_score'], reverse=True)

            # Add top fallback papers to fill quota
            needed = PAPERS_PER_INTEREST - len(top_papers)
            additional_papers = fallback_fresh[:needed]

            for p in additional_papers:
                seen_papers.add(p['arxiv_id'])
                new_papers_count += 1

            top_papers.extend(additional_papers)
            all_papers[interest_name] = top_papers
            print(f"   ✨ After fallback: {len(top_papers)} total papers")

        # Be kind: 5-second delay between queries (extra respectful to arXiv)
        time.sleep(5)

    # Save updated seen papers
    save_seen_papers(seen_papers)

    print(f"\n📊 Summary:")
    print(f"   • Total new papers: {new_papers_count}")
    print(f"   • Total duplicates skipped: {duplicate_count}")
    print(f"   • Total tracked papers: {len(seen_papers)}")

    save_html_digest(all_papers)
    save_tiktok_feed(all_papers)
    print("\n✅ Done! Open the HTML files in your browser.")