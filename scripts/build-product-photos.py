#!/usr/bin/env python3
"""Builds the product photo folder and credit data.

Usage:  python3 scripts/build-product-photos.py <folder with the original .jpg files and the credit files>

Originals are copied byte-for-byte to public/images/products/originals/.
Web copies (same picture, scaled down, never cropped) go to public/images/products/web/
as <name>-1200.webp and <name>-480.webp.
Re-run it any time more photos arrive; it only adds or refreshes.
"""
import csv, glob, json, os, re, shutil, sys
from PIL import Image

src = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_o = os.path.join(root, 'public/images/products/originals')
out_w = os.path.join(root, 'public/images/products/web')
os.makedirs(out_o, exist_ok=True); os.makedirs(out_w, exist_ok=True)

# where each photo came from: icecat or commons/stock
source = {}
for line in open(os.path.join(src, '_mapping.tsv'), encoding='utf-8'):
    p = line.rstrip('\n').split('\t')
    if len(p) >= 2: source[p[0]] = p[1]
# Part 2 files are not in _mapping.tsv; they come from Commons (see credits-pass3.txt)
shot = [l for l in csv.reader(open(os.path.join(root, 'data/photo-shot-list.csv'), encoding='utf-8'))][1:]
shot_files = [r[1] for r in shot]
# device + storage as written in the shot list -> photo filename (used to match products whose colour is unknown)
alias = {}
for r in shot:
    a = re.sub(r'[^a-z0-9]+', '-', (r[3] + ' ' + r[4]).lower().replace('+', ' plus ')).strip('-')
    alias[r[1][:-4]] = a

credits = {}  # filename -> dict
ledger = os.path.join(src, 'commons-credits-ledger.csv')
for r in csv.DictReader(open(ledger, encoding='utf-8-sig')):
    if r.get('licence'):
        credits[r['csv_filename']] = dict(title=r['source_title'], author=r['author'], licence=r['licence'],
            licence_url=r['licence_url'], page=r['file_page'], note='')

def expand(first, tok):
    segs = first.split('-'); t = tok.split('-')
    for k in range(1, len(segs)):
        cand = '-'.join(segs[:-k] + t) + '.jpg'
        if cand in shot_files: return cand[:-4]
    return None

pass3 = glob.glob(os.path.join(src, 'credits-pass3.txt'))
pat = re.compile(r'^(?P<files>[^:]+): "(?P<title>.+?)" by (?P<author>.+?), (?P<lic>CC BY(?:-SA)? [0-9.]+|CC0) - (?P<url>https?://\S+)$')
if pass3:
    for line in open(pass3[0], encoding='utf-8'):
        m = pat.match(line.strip())
        if not m: continue
        toks = [t.strip() for t in m['files'].split(' / ')]
        stems = [toks[0]] + [expand(toks[0], t) or '-'.join(toks[0].split('-')[:-1] + [t]) for t in toks[1:]]
        stems = [s if s.endswith('.jpg') else s for s in stems]
        # first token may lack a size suffix variant (macbook m2 / m3): resolve by prefix
        for s in stems:
            names = [f for f in shot_files if f[:-4] == s] or [f for f in shot_files if f.startswith(s)]
            for f in names:
                lic = m['lic']; ver = lic.split()[-1]
                lu = {'CC BY-SA': 'https://creativecommons.org/licenses/by-sa/%s', 'CC BY': 'https://creativecommons.org/licenses/by/%s'}
                base = 'CC BY-SA' if 'SA' in lic else 'CC BY'
                credits[f] = dict(title=m['title'], author=m['author'], licence=lic,
                    licence_url=lu[base] % ver, page=m['url'], note='Converted from PNG to JPG on a white background.' if 'png' in m['title'].lower() else '')
for f in shot_files:
    source.setdefault(f, 'stock/commons')

manifest = {}; made = 0
for f in sorted(os.listdir(src)):
    if not f.lower().endswith('.jpg'): continue
    slug = f[:-4]
    shutil.copyfile(os.path.join(src, f), os.path.join(out_o, f))
    im = Image.open(os.path.join(src, f)).convert('RGB')
    for w in (1200, 480):
        o = im.copy()
        if o.width > w: o = o.resize((w, round(o.height * w / o.width)), Image.LANCZOS)
        o.save(os.path.join(out_w, f'{slug}-{w}.webp'), 'WEBP', quality=82, method=6)
    kind = 'icecat' if source.get(f) == 'icecat' else 'commons'
    manifest[slug] = {'kind': kind, 'w': im.width, 'h': im.height, 'key': alias.get(slug, slug)}
    if kind == 'commons' and f in credits: manifest[slug]['credit'] = credits[f]
    made += 1

json.dump(dict(sorted(manifest.items())), open(os.path.join(root, 'data/product-photos.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
no_credit = [k for k, v in manifest.items() if v['kind'] == 'commons' and 'credit' not in v]
print('photos', made, '| icecat', sum(v['kind'] == 'icecat' for v in manifest.values()),
      '| commons with credit', sum('credit' in v for v in manifest.values()), '| commons without credit', len(no_credit))
print('\n'.join(no_credit))
