#!/usr/bin/env python3
"""Collect public growth signals. Optional owner traffic access: --traffic.
No telemetry is added to the plugin. GITHUB_TOKEN is optional and never logged.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

REPO = 'Almalkiid/flashcard-studio'
API = 'https://api.github.com/repos/' + REPO
ROOT = Path(__file__).resolve().parents[1]
errors = []


def get(url):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'FlashcardStudioGrowth'}
    token = os.environ.get('GITHUB_TOKEN')
    if token and url.startswith('https://api.github.com/'):
        headers['Authorization'] = 'Bearer ' + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            return json.load(response)
    except (urllib.error.URLError, ValueError) as exc:
        code = getattr(exc, 'code', None)
        errors.append({'source': url, 'reason': 'HTTP ' + str(code) if code else type(exc).__name__})
        return None


def pages(endpoint):
    items = []
    for page in range(1, 101):
        batch = get(API + endpoint + ('&' if '?' in endpoint else '?') + f'per_page=100&page={page}')
        if not isinstance(batch, list):
            return None
        items.extend(batch)
        if len(batch) < 100:
            return items
    errors.append({'source': endpoint, 'reason': 'pagination cap; value unavailable'})
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--traffic', action='store_true', help='Request private traffic using your authorized GITHUB_TOKEN')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'docs/launch/snapshots')
    args = parser.parse_args()
    repo = get(API)
    if not isinstance(repo, dict) or 'stargazers_count' not in repo:
        raise SystemExit('Repository baseline unavailable; no snapshot written.')
    releases = pages('/releases')
    issues = pages('/issues?state=all')
    stats_url = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json'
    stats = get(stats_url)
    stat = stats.get('flashcard-studio') if isinstance(stats, dict) else None
    downloads = None if releases is None else [{'tag': r['tag_name'], 'main_js_downloads': next((a['download_count'] for a in r['assets'] if a['name'] == 'main.js'), None)} for r in releases if not r['draft']]
    main_counts = [r['main_js_downloads'] for r in downloads] if downloads is not None else None
    now = dt.datetime.now(dt.timezone.utc)
    data = {'observed_at': now.isoformat(), 'repository': REPO, 'sources': {'repository': API, 'releases': API+'/releases', 'issues': API+'/issues?state=all', 'obsidian_downloads': stats_url}, 'stars': repo['stargazers_count'], 'forks': repo['forks_count'], 'target_stars': 100, 'open_issues': None if issues is None else sum(i['state']=='open' for i in issues if 'pull_request' not in i), 'closed_issues': None if issues is None else sum(i['state']=='closed' for i in issues if 'pull_request' not in i), 'release_main_js_downloads': sum(main_counts) if main_counts is not None and all(x is not None for x in main_counts) else None, 'release_breakdown': downloads, 'obsidian_reported_downloads': stat.get('downloads') if stat else None, 'unique_installations': None, 'traffic_views': get(API+'/traffic/views') if args.traffic else None, 'traffic_clones': get(API+'/traffic/clones') if args.traffic else None, 'traffic_status': 'requested; see values/errors' if args.traffic else 'not requested; owner access required', 'errors': errors}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    path = args.output_dir / (now.strftime('%Y-%m-%dT%H%M%SZ')+'.json')
    path.write_text(json.dumps(data, indent=2)+'\n')
    existing = sorted(args.output_dir.glob('*.json'))
    baseline = json.loads(existing[0].read_text())
    rows = [('Stars',data['stars']),('Change since first snapshot', data['stars']-baseline['stars']),('Remaining to 100',max(0,100-data['stars'])),('Forks',data['forks']),('Open issues (PRs excluded)',data['open_issues']),('Closed issues',data['closed_issues']),('Release main.js downloads (all releases)',data['release_main_js_downloads']),('Obsidian reported downloads',data['obsidian_reported_downloads']),('Unique installations',None),('GitHub views / clones', 'See JSON' if args.traffic else None)]
    text = '# Growth dashboard\n\nObserved: '+data['observed_at']+' (UTC). Goal: 100 genuine stars; no deadline guarantee.\n\n| Metric | Value |\n| --- | --- |\n'+'\n'.join(f'| {k} | {"Unavailable" if v is None else v} |' for k,v in rows)
    text += '\n\nDownloads are events, not unique people, active users, or installations. GitHub and Obsidian counts may refresh at different times. Never sum the two sources. Changes are descriptive, not attribution to a post. Traffic windows overlap: do not add rolling totals. No conversion rate is calculated without a valid denominator.\n\nRun `python scripts/growth_snapshot.py` for a fresh public snapshot. Owner traffic can be collected with `--traffic` and an authorized `GITHUB_TOKEN`; do not commit private traffic data without reviewing it. Snapshot errors remain null/unavailable, never zero.\n\n[Community feedback and post ledger](feedback.md) · [Campaign](campaign.md) · [Audit](audit.md)\n'
    (args.output_dir.parent/'dashboard.md').write_text(text)
    print(json.dumps({'snapshot':str(path),'stars':data['stars'],'main_js_downloads':data['release_main_js_downloads'],'obsidian_downloads':data['obsidian_reported_downloads'],'errors':errors}))

if __name__ == '__main__':
    main()
