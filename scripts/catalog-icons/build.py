#!/usr/bin/env python3
"""Builds the Architecture catalog icons (docs/plans/architecture-catalog.md, "Icons").

    python3 scripts/catalog-icons/build.py            # build from catalog-icons.json
    python3 scripts/catalog-icons/build.py --init     # write catalog-icons.json from the rules below, then build

Run it when catalog entries change and commit what it writes:
frontend/src/assets/catalog/<slug>[.dark|.light].svg, manifest.json and ICON-SOURCES.md.

Needs network (the sources are downloaded into scripts/catalog-icons/.cache),
rsvg-convert and ImageMagick (`magick`) for the contrast test.
"""
import base64
import io
import json
import re
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CATALOG_DOC = ROOT / 'docs/plans/architecture-catalog.md'
MAPPING = HERE / 'catalog-icons.json'
MANUAL = HERE / 'manual'
CACHE = HERE / '.cache'
OUT = ROOT / 'frontend/src/assets/catalog'

SIMPLE_ICONS = '16.34.0'
DEVICON = '2.17.0'
LUCIDE = '1.52.0'
GOOGLE_CLOUD_ZIP = 'https://cloud.google.com/static/icons/files/google-cloud-icons.zip'

# Theme surfaces and ink, from DESIGN.md.
SURFACE = {'light': (0xFF, 0xFF, 0xFF), 'dark': (0x17, 0x1A, 0x1F)}
INK = {'light': '#14171A', 'dark': '#E6E8EB'}
MUTED = {'light': '#5B6470', 'dark': '#8B94A0'}
FAINT_SHARE = 0.5  # more than half of the logo under 1.5:1 contrast marks it faint

# Entries that name a kind of thing get a Lucide icon even when a brand matches the name.
GENERIC = {
    'bare-metal': 'server', 'vps': 'server-cog', 'vm': 'box', 'container': 'container', 'on-premise': 'building-2',
    'laptop': 'laptop', 'vpc': 'network', 'subnet': 'layout-grid', 'dmz': 'shield-half', 'region': 'globe',
    'availability-zone': 'map-pin', 'browser': 'app-window', 'desktop': 'monitor', 'iot-device': 'cpu',
    'service': 'cog', 'worker': 'repeat', 'scheduled-job': 'clock', 'cli': 'terminal', 'batch-job': 'layers',
    'nfs': 'folder-sync', 'local-disk': 'hard-drive', 'static-site': 'file-code', 'saas': 'cloud',
}
# A branded entry with no logo yet shows its subkind's icon, muted.
SUBKIND = {
    'compute': 'server', 'orchestration': 'layers', 'network': 'network', 'aws': 'cloud', 'gcp': 'cloud', 'azure': 'cloud',
    'paas': 'cloud', 'client': 'monitor', 'language': 'code-xml', 'frontend': 'app-window', 'backend': 'server',
    'mobile': 'smartphone', 'database': 'database', 'cache': 'zap', 'search': 'search', 'broker': 'mail', 'gateway': 'route',
    'storage': 'hard-drive', 'auth': 'lock', 'observability': 'activity', 'ai': 'brain-circuit', 'job': 'cog', 'external': 'plug',
}
# Official Google Cloud icons (terms cleared by the owner on 2026-10-07). AWS and Azure stay on
# their Lucide fallback until their terms are cleared.
GOOGLE_CLOUD = {
    'gcp-compute-engine': 'compute_engine', 'gcp-cloud-run': 'cloud_run', 'gcp-gke': 'google_kubernetes_engine',
    'gcp-cloud-functions': 'cloud_functions', 'gcp-app-engine': 'app_engine', 'gcp-cloud-sql': 'cloud_sql',
    'gcp-memorystore': 'memorystore', 'gcp-pubsub': 'pubsub', 'gcs': 'cloud_storage', 'firestore': 'firestore',
    'gcp-spanner': 'cloud_spanner', 'gcp-bigquery': 'bigquery', 'gcp-bigtable': 'bigtable',
    'gcp-load-balancing': 'cloud_load_balancing', 'gcp-cloud-cdn': 'cloud_cdn', 'gcp-api-gateway': 'cloud_api_gateway',
    'gcp-identity-platform': 'identity_platform', 'gcp-cloud-tasks': 'cloud_tasks', 'gcp-cloud-scheduler': 'cloud_scheduler',
}
# Product-family logos: the entry uses the logo of the product it belongs to.
FAMILY = {
    'kubernetes-namespace': 'kubernetes', 'kubernetes-node': 'kubernetes', 'kubernetes-pod': 'kubernetes',
    'docker-host': 'docker', 'docker-swarm': 'docker', 'digitalocean-droplet': 'digitalocean',
    'digitalocean-app-platform': 'digitalocean', 'digitalocean-managed-db': 'digitalocean', 'mongodb-atlas': 'mongodb',
    'firebase-hosting': 'firebase', 'firebase-auth': 'firebase', 'firebase-cloud-messaging': 'firebase',
    'supabase-auth': 'supabase', 'loki': 'grafana', 'tempo': 'grafana', 'vue': 'vuejs', 'sveltekit': 'svelte',
    'traefik': 'traefikproxy', 'opentelemetry-collector': 'opentelemetry', 'apache-httpd': 'apache',
    'whatsapp-business': 'whatsapp', 'redis-streams': 'redis', 'golang': 'go', 'go-net-http': 'go',
    'aspnet-core': 'dotnetcore', 'kotlin-multiplatform': 'kotlin', 'swiftui': 'swift', 'alibaba-cloud-ecs': 'alibabacloud',
    'tanstack-start': 'tanstack', 'actix-web': 'actix', 'timescaledb': 'timescale', 'google-oauth': 'google',
}
NO_LOGO_MATCH = {'vm', 'container'}  # names that match an unrelated brand
# AWS and Azure services wait for their icon terms to be cleared, whatever source carries them.
PENDING_TERMS = {'dynamodb', 'cloudfront'}


def pending_terms(slug):
    return slug.startswith(('aws-', 'azure-')) or slug in PENDING_TERMS


def catalog_entries():
    section = subkind = None
    for line in CATALOG_DOC.read_text().splitlines():
        if line.startswith('## '):
            section, subkind = line[3:].strip(), None
        m = re.match(r'### Subkind `([^`]+)`', line)
        if m:
            subkind = m.group(1)
        m = re.match(r'\| `([a-z0-9-]+)` \| ([^|]+)\|', line)
        if m and section in ('Hosts', 'Systems') and subkind:
            yield {'slug': m.group(1), 'name': m.group(2).strip(), 'subkind': subkind}


def fetch(url, name):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if not path.exists():
        path.write_bytes(read(url))
    return path


def read(url, attempts=3):
    # Some hosts close the connection on Python's default user agent.
    request = urllib.request.Request(url, headers={'User-Agent': 'dokudocs-catalog-icons/1.0'})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise


def npm_tarball(package, version):
    meta = json.loads(read(f'https://registry.npmjs.org/{package}/{version}'))
    return tarfile.open(fetch(meta['dist']['tarball'], f'{package}-{version}.tgz'))


def norm(text):
    text = text.lower().replace('.js', 'js').replace('+', 'plus').replace('#', 'sharp').replace('.', 'dot')
    return re.sub(r'[^a-z0-9]', '', text)


class Sources:
    def __init__(self):
        si = npm_tarball('simple-icons', SIMPLE_ICONS)
        self.si_tar = si
        data = json.load(si.extractfile('package/data/simple-icons.json'))
        self.si = {}
        for icon in data:
            for key in [icon['slug'], norm(icon['title'])] + [norm(a) for a in (icon.get('aliases') or {}).get('aka', [])]:
                self.si.setdefault(key, icon)
        self.lucide_tar = npm_tarball('lucide-static', LUCIDE)
        devicon = json.loads(fetch(f'https://cdn.jsdelivr.net/gh/devicons/devicon@v{DEVICON}/devicon.json', f'devicon-{DEVICON}.json').read_text())
        self.devicon = {}
        for d in devicon:
            if 'original' not in d.get('versions', {}).get('svg', []):
                continue
            for key in [norm(d['name'])] + [norm(a) for a in d.get('altnames', []) or []]:
                self.devicon.setdefault(key, d['name'])
        self.gcp = zipfile.ZipFile(fetch(GOOGLE_CLOUD_ZIP, 'google-cloud-icons.zip'))

    def simple_icon(self, slug):
        icon = next(i for i in self.si.values() if i['slug'] == slug)
        svg = self.si_tar.extractfile(f'package/icons/{slug}.svg').read().decode()
        return re.search(r'<path d="([^"]+)"', svg).group(1), icon['hex']

    def devicon_svg(self, name):
        url = f'https://cdn.jsdelivr.net/gh/devicons/devicon@v{DEVICON}/icons/{name}/{name}-original.svg'
        return fetch(url, f'devicon-{name}.svg').read_text()

    def lucide_inner(self, name):
        svg = self.lucide_tar.extractfile(f'package/icons/{name}.svg').read().decode()
        return re.sub(r'\s+', ' ', svg[svg.index('>', svg.index('<svg')) + 1:svg.rindex('</svg>')]).strip()

    def gcp_svg(self, name):
        member = next(n for n in self.gcp.namelist() if n.endswith('/' + name + '.svg') and '__MACOSX' not in n)
        return self.gcp.read(member).decode()


def initial_mapping(sources):
    mapping = {}
    for entry in catalog_entries():
        slug, name = entry['slug'], entry['name']
        keys = [FAMILY.get(slug, ''), slug, norm(name), norm(name.split('(')[0]), norm(slug)]
        if slug in GENERIC:
            mapping[slug] = {'source': 'lucide', 'name': GENERIC[slug]}
        elif slug in GOOGLE_CLOUD:
            mapping[slug] = {'source': 'google-cloud', 'name': GOOGLE_CLOUD[slug]}
        elif pending_terms(slug):
            mapping[slug] = {'source': 'lucide', 'name': SUBKIND[entry['subkind']], 'fallback': True}
        elif (MANUAL / f'{slug}.svg').exists():
            mapping[slug] = {'source': 'manual', 'name': f'{slug}.svg'}
        elif slug not in NO_LOGO_MATCH and next((k for k in keys if k in sources.devicon), None):
            mapping[slug] = {'source': 'devicon', 'name': sources.devicon[next(k for k in keys if k in sources.devicon)]}
        elif slug not in NO_LOGO_MATCH and next((k for k in keys if k in sources.si), None):
            mapping[slug] = {'source': 'simple-icons', 'name': sources.si[next(k for k in keys if k in sources.si)]['slug']}
        else:
            mapping[slug] = {'source': 'lucide', 'name': SUBKIND[entry['subkind']], 'fallback': True}
    return mapping


def lucide_svg(inner, color):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" '
            f'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{inner}</svg>')


def simple_svg(path, color):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="{color}" d="{path}"/></svg>'


def clean(svg):
    """Drops comments, metadata and the XML prolog; keeps everything that draws."""
    svg = re.sub(r'<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--.*?-->', '', svg, flags=re.S)
    svg = re.sub(r'<metadata.*?</metadata>', '', svg, flags=re.S)
    return re.sub(r'>\s+<', '><', svg).strip()


def lum(rgb):
    c = [v / 255 for v in rgb]
    c = [v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4 for v in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def contrast(a, b):
    x, y = lum(a), lum(b)
    return (max(x, y) + .05) / (min(x, y) + .05)


def faint(svg):
    png = subprocess.run(['rsvg-convert', '-w', '64', '-h', '64', '--keep-aspect-ratio'], input=svg.encode(),
                         capture_output=True, check=True).stdout
    raw = subprocess.run(['magick', 'png:-', '-depth', '8', 'rgba:-'], input=png, capture_output=True, check=True).stdout
    opaque = [raw[i:i + 3] for i in range(0, len(raw), 4) if raw[i + 3] > 128]
    result = {}
    for theme, surface in SURFACE.items():
        dim = sum(1 for p in opaque if contrast(p, surface) < 1.5)
        result[theme] = bool(opaque) and dim / len(opaque) > FAINT_SHARE
    return result


def build(mapping, sources):
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.svg'):
        old.unlink()
    manifest, credits = {}, {}
    for slug, spec in sorted(mapping.items()):
        source, name = spec['source'], spec['name']
        files = {}
        tile = {}
        if source == 'lucide':
            inner = sources.lucide_inner(name)
            palette = MUTED if spec.get('fallback') else INK
            files = {'light': lucide_svg(inner, palette['light']), 'dark': lucide_svg(inner, palette['dark'])}
        elif source == 'simple-icons':
            path, hex_color = sources.simple_icon(name)
            base = simple_svg(path, '#' + hex_color)
            files = {'light': base, 'dark': base}
            for theme, is_faint in faint(base).items():
                if is_faint:  # a one-colour logo is redrawn in ink where it fades (rule 2)
                    files[theme] = simple_svg(path, INK[theme])
        else:
            if source == 'devicon':
                base = sources.devicon_svg(name)
            elif source == 'google-cloud':
                base = sources.gcp_svg(name)
            else:
                base = (MANUAL / name).read_text()
            base = clean(base)
            files = {'light': base, 'dark': base}
            for theme, is_faint in faint(base).items():
                if is_faint:  # a multi-colour logo keeps its colours and sits on a contrasting tile (rule 3)
                    tile[theme] = True
        (OUT / f'{slug}.svg').write_text(files['light'])
        entry = {'source': source, 'light': f'{slug}.svg', 'dark': f'{slug}.svg'}
        if files['dark'] != files['light']:
            (OUT / f'{slug}.dark.svg').write_text(files['dark'])
            entry['dark'] = f'{slug}.dark.svg'
        if tile:
            entry['tile'] = tile
        if spec.get('fallback'):
            entry['fallback'] = True
        manifest[slug] = entry
        credits.setdefault(source, []).append((slug, name))
    # Subkind icons for slugs the manifest does not know, and the palette's Group item.
    for icon in sorted(set(SUBKIND.values()) | {'square-dashed'}):
        inner = sources.lucide_inner(icon)
        palette = INK if icon == 'square-dashed' else MUTED
        (OUT / f'lucide-{icon}.svg').write_text(lucide_svg(inner, palette['light']))
        (OUT / f'lucide-{icon}.dark.svg').write_text(lucide_svg(inner, palette['dark']))
        manifest[f'lucide-{icon}'] = {'source': 'lucide', 'light': f'lucide-{icon}.svg', 'dark': f'lucide-{icon}.dark.svg', 'fallback': icon != 'square-dashed'}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=1, sort_keys=True) + '\n')
    licences = {
        'google-cloud': 'Google Cloud icons, cloud.google.com/icons; terms checked by the owner on 2026-10-07',
        'devicon': f'Devicon {DEVICON}, MIT',
        'simple-icons': f'Simple Icons {SIMPLE_ICONS}, CC0 1.0 (logos remain trademarks of their owners)',
        'lucide': f'Lucide {LUCIDE}, ISC',
        'manual': 'Vendor press kits; see the line for each logo',
    }
    lines = ['# Catalog icon sources', '', 'Generated by `scripts/catalog-icons/build.py`. Logos are shown only to name the product they belong to.', '']
    for source in sorted(credits):
        lines += [f'## {licences[source]}', '']
        lines += [f'- `{slug}`: {name}' for slug, name in credits[source]]
        lines.append('')
    (OUT / 'ICON-SOURCES.md').write_text('\n'.join(lines))
    print(f'{len(manifest)} icons:', {s: len(v) for s, v in credits.items()})


def main():
    sources = Sources()
    if '--init' in sys.argv or not MAPPING.exists():
        MAPPING.write_text(json.dumps(initial_mapping(sources), indent=1, sort_keys=True) + '\n')
    build(json.loads(MAPPING.read_text()), sources)


if __name__ == '__main__':
    main()
