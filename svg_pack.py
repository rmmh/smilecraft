#!/usr/bin/python3

import json
import os
import re
import subprocess
import sys


def munge_svg(path, e=None, verbose=False):
    svg_data = open(path).read()
    svg_data = svg_data.replace('\n', ' ').strip()
    if re.search(r'<svg[^>]*width', svg_data):
        if 'ENTITY' in svg_data and False:
            svg_data = subprocess.check_output(
                ['npx', 'svgo', '-o', '-', path]).decode('utf8')
        svg_data_before = svg_data
        # explicit width/height screws up automatic scaling
        dim_re = re.compile(r' (width|height)="[^"]*"')

        def fix_header(m):
            attrib = dict(re.findall(r'(\S+)="([^"]*)"', m.group(0)))
            if 'viewBox' not in attrib:
                attrib['viewBox'] = '0 0 %s %s' % (attrib['width'],
                                                   attrib['height'])
            attrib.pop('width')
            attrib.pop('height')
            return '<svg %s>' % ' '.join('%s="%s"' % i for i in attrib.items())

        svg_data = re.sub(r'<svg[^>]*>', fix_header, svg_data)
        if e and verbose:
            print('stripping header dimensions from', e['char'], e['name'],
                  svg_data == svg_data_before)
    return svg_data


def pack_svg(verbose=False):
    ems = json.load(open('data/emoji.json'))
    char_ems = {e['char']: e for e in ems}
    svg_bundles = {}

    for e in ems:
        em = e['char']
        r = e['rank']

        svg_path = ''
        svg_path = 'noto-emoji/svg/emoji_u%s.svg' % '_'.join('%04x' % ord(c)
                                                             for c in em)
        if not os.path.exists(svg_path):
            svg_path = svg_path.replace('.', '_200d_2642.')
        if not os.path.exists(svg_path) and e['name'].startswith('flag_'):
            country = e['name'].replace('flag_', '').upper()
            svg_path = 'noto-emoji/third_party/region-flags/svg/%s.svg' % country
        assert os.path.exists(svg_path), (em, svg_path)
        if e['name'].startswith('flag_'):
            bundle_name = 'flag'
        elif r == -1:
            bundle_name = 'misc'
        else:
            bundle_name = str(r // 256)
        svg_data = munge_svg(svg_path, e, verbose)
        if verbose:
            print(em, e['name'], json.dumps(em), svg_path, len(svg_data))
        svg_bundles.setdefault(bundle_name, {})[em] = svg_data

    for name, svgs in sorted(svg_bundles.items()):
        if 0:
            open('data/emoji_svgs_%s.json' % name,
                 'w').write(json.dumps(svgs, sort_keys=True, indent=0))
        with open('data/emoji_svgs_%s.css' % name, 'w') as f:
            for char, svg in sorted(svgs.items()):
                # based on https://yoksel.github.io/url-encoder/
                # and https://mathiasbynens.be/notes/css-escapes
                svg = svg.strip().replace("'", "\\'")
                svg = svg.replace('\n', '\\A').replace('#', '%23')
                f.write(
                    ".em-%s{background-image:url('data:image/svg+xml,%s')}\n" %
                    (char_ems[char]['abbr'], svg))
            size = f.tell()
            print('wrote %.1dK (%d emoji, %dB each) to %s' %
                  (size / 1024, len(svgs), size / len(svgs), f.name))


if __name__ == '__main__':
    if sys.argv[1:]:
        for fname in sys.argv[1:]:
            print(fname, munge_svg(fname))
    else:
        pack_svg()
