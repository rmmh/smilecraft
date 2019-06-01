#!/usr/bin/python3

import json
import os
import urllib.parse


def pack_svg(verbose=False):
    ems = json.load(open('data/emoji.json'))
    char_ems = {e['char']: e for e in ems}
    svg_bundles = {}

    for e in ems:
        em = e['char']
        r = e['rank']

        svg_path = ''
        if not e['name'].startswith('flag_'):
            svg_path = 'noto-emoji/svg/emoji_u%s.svg' % '_'.join(
                '%04x' % ord(c) for c in em)
            if not os.path.exists(svg_path):
                svg_path = svg_path.replace('.', '_200d_2642.')
            assert os.path.exists(svg_path), (em, svg_path)
            if r == -1:
                bundle_name = 'misc'
            else:
                bundle_name = str(r // 256)
            svg_data = open(svg_path).read()
            if svg_data.startswith('<svg width'):
                svg_data_before = svg_data
                # explicit width/height screws up automatic scaling
                svg_data = svg_data.replace('<svg width="128" height="128"',
                                            '<svg')
                if verbose:
                    print('stripping header dimensions from', em, e['name'],
                          svg_data == svg_data_before)

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
                svg = urllib.parse.quote(svg, safe='" =:/<>')
                # svg = svg.strip().replace("'", "\\'").replace('\n', '\\A')
                f.write(
                    ".em-%s{background-image:url('data:image/svg+xml,%s')}\n" %
                    (char_ems[char]['abbr'], svg))
            print('wrote %.1dK to %s' % (f.tell() / 1024, f.name))


if __name__ == '__main__':
    pack_svg()
