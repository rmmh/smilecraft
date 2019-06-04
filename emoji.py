#!/usr/bin/python3

import argparse
import base64
import collections
import json
import os
import re
import struct
import time
import urllib

import annoy
import numpy

import svg_pack


def pack(v):
    return base64.b64encode(struct.pack('>f', v)[:3]).decode('utf8')


def unpack(v):
    return struct.unpack('>f', base64.b64decode(v) + b'\x7f')[0]


def create():
    emoji_names = json.load(open('data/emoji_names.json'))
    names_emoji = {v[0]: k for k, v in emoji_names.items()}
    emoji_vecs = {
        x[0].replace('\ufe0f', ''): [float(y) for y in x[1:]]
        for x in (l.split() for l in open('data/tweets_vec_emoji.txt'))
    }
    rankings = json.load(open('data/emojitracker_rankings.json'))
    rankings_emoji = [
        chr(int(r['id'], 16)) if '-' not in r['id'] else r['char']
        for r in rankings
    ]
    name_to_ranking = {
        k: int(v in rankings_emoji) and rankings_emoji.index(v)
        for k, v in names_emoji.items()
    }

    # Abbreviate with a greedy strategy, trying a few different options for
    # each word and breaking if this fails.
    # Manually assign some abbreviations so it doesn't get wedged
    abbrevs = {
        'cat': 'cat',
        'ft': 'feet',
        'rat': 'rat',
        'ship': 'ship',
        'fax': 'fax',
        #TODO: re-enable when I collect vectors for these ~rare emoji~
        # 'cl': 'cl',
        'fist': 'fist',
    }

    alt_abbrevs = {
        'house': 'hom',
        'free': 'zd',
        'fireworks': 'fw',
        'corn': 'mz',
        'chestnut': 'cnt',
        'scroll': 'sll',
        'flashlight': 'fl',
        'fallen_leaf': 'fall',
        'football': 'ftbl',
        'four_leaf_clover': 'flc',
        'large_blue_circle': 'lbc',
        'large_blue_diamond': 'lbd',
        'm': 'lm',
        'b': 'lb',
        'a': 'lta',
        'sa': 'jsa',
        'sparkler': 'srk',
        'poodle': 'pdl',
        '100': 'hu',
    }

    skip = {'sa'}

    def make_abbrevs(v):
        if v in alt_abbrevs:
            yield alt_abbrevs[v]
            return
        elif v.startswith('clock'):
            a = v.replace('clock', 'c')
            if a != 'c10':
                a = a.rstrip('0')
            yield a
        elif v.startswith('flag_'):
            yield v.replace('flag_', 'fl')[:4]
            return
        ws = v.split('_')
        a = ''.join(w[0] for w in ws)
        yield a[:2]
        yield a[:3]
        yield a
        yield ws[0][:2] + ''.join(w[0] for w in ws[1:])
        yield ws[0][0] + ws[0][-1] + ''.join(w[0] for w in ws[1:])
        yield ws[0][:2] + ws[0][-1] + ''.join(w[0] for w in ws[1:])
        yield ws[0][:3] + ''.join(w[0] for w in ws[1:])
        yield re.sub(r'[aeiou]', '', v)[:3] or a

    err = 0
    for k, vs in sorted(emoji_names.items(),
                        key=lambda k: name_to_ranking[k[1][0]] or 150):
        if vs[0] in skip:
            continue
        elif re.match(r'^u[567]', vs[0]):
            continue
        if k not in emoji_vecs:
            # print('NO VEC FOR', k, vs, json.dumps([k]))
            continue
        v = vs[0]
        if v.startswith('family_'):  # discord doesn't render these well
            continue
        if abbrevs.get(v) == v:
            continue

        ws = v.split('_')

        az = list(make_abbrevs(v))

        for a in az:
            if abbrevs.get(a) in (v, None):
                abbrevs[a] = v
                break
        else:
            print("CAN'T FIT", len(abbrevs), v, a, az, abbrevs[az[0]])
            err = 1
            break

    print(' '.join(rankings_emoji))

    out = []
    evs = []

    if not err:
        for k, v in sorted(abbrevs.items(), key=lambda k: k[1]):
            em = names_emoji[v]
            if em in rankings_emoji:
                r = rankings_emoji.index(em)
            else:
                r = -1
            ev = emoji_vecs[em]
            evp = ''.join(pack(e) for e in ev)
            evs.extend(ev)

            print(em, k, v, json.dumps(em), r)

            out.append({
                'char': em,
                'abbr': k,
                'name': v,
                'rank': r,
                'vec': evp
            })

            for e in ev:
                rt = unpack(pack(e))
                if e == 0:
                    print('??? 0 value', k, v, e)
                else:
                    assert (e - rt) / e < 1e-4, (e, rt, pack(e))

    print(min(evs), max(evs))

    open('data/emoji.json', 'w').write(json.dumps(out).replace('}, ', '},\n'))


ems = []
abbr_ems = {}
char_ems = {}
t = None


def load():
    global ems, abbr_ems, char_ems, t
    ems = json.load(open('data/emoji.json'))
    ems = [e for e in ems
           if not e['name'].startswith('flag_')]  # flags are BORING
    #ems = [e for e in ems if e['rank'] is not False and e['rank'] < 528]  # 528=512
    ems = [e for e in ems if 0 <= e['rank'] < 808]  # 808=777
    ems = [e for e in ems if 0 <= e['rank'] < 258]  # 808=777
    for e in ems:
        e['vec'] = numpy.asarray(
            [unpack(e['vec'][x:x + 4]) for x in range(0, len(e['vec']), 4)])
    abbr_ems = {e['abbr']: e for e in ems}

    t = annoy.AnnoyIndex(300, metric='manhattan')
    for n, e in enumerate(ems):
        t.add_item(n, e['vec'])
    t.build(1000)


def nearest(vec, abbrs=None):
    abbrs = abbrs or []
    for e in t.get_nns_by_vector(vec, len(abbrs) + 1):
        if ems[e]['abbr'] not in abbrs:
            return ems[e]
    raise ValueError('nearest neighbor failed?')


class Equation:
    def __init__(self, abbrs):
        counts = collections.Counter(abbrs)
        self.coeffs = sorted(((-(-1)**k * (1 + (k - 1) // 2), v)
                              for v, k in counts.most_common()),
                             reverse=True)

    def __str__(self):
        r = ''
        for c, a in self.coeffs:
            if c > 0:
                if r:
                    r += ' + '
            elif c == -1:
                r += ' - ' if r else '-'
            if abs(c) != 1:
                r += '%d' % c
            r += abbr_ems[a]['char']
        return r

    def value(self):
        return sum(c * abbr_ems[a]['vec'] for c, a in self.coeffs)


def comb(es):
    abbrs = [e['abbr'] for e in es]
    eq = Equation(e['abbr'] for e in es)
    return nearest(eq.value(), set(abbrs))


def print_legend():
    W = 8
    legend = [('%s %-6s' % (e['char'], e['abbr'])) for e in ems]
    print('\n'.join(''.join(legend[x:x + W])
                    for x in range(0,
                                   len(legend) + W, W)))


def generate():
    load()
    ems.sort(key=lambda e: e['rank'] is not False and e['rank'])

    print('searching for equations for', len(ems),
          'emojis, given the initial set:')

    print_legend()

    have = list(ems[:10])

    print(' '.join(e['abbr'] + e['char'] for e in have))

    def attempt(es):
        es.sort(key=lambda e: e['abbr'])
        ar = [e['abbr'] for e in es]
        ars = ' '.join(ar)
        if ars in tried:
            return
        n = comb(es)
        if n not in have:
            have.append(n)
            work.append(n)
            print(
                '%4d/%d %3d  ' % (len(have), len(ems), len(work)),
                # ' '.join(a['abbr'] + a['char'] for a in es),
                str(Equation(ar)).rjust(10),
                '=',
                n['char'])
        edges.append(' '.join(e['abbr'] for e in [n] + es))
        tried.add(ars)

    tried = set()
    work = list(have)
    edges = []
    while work and 1:
        a = work.pop(0)
        attempt([a])
        attempt([a, a])
        #attempt([a, a, a])
        #attempt([a, a, a, a])
        for x in have:
            if x != a:
                attempt([a, x])
                #attempt([a, x, x])
                #attempt([a, x, x, x])
                #attempt([a, a, x])
                #attempt([a, a, x, x])

                if 0:  # 2X - Y
                    attempt([a, a, x, x, x])
                    attempt([a, a, a, x, x])

                #attempt([a, a, a, x])
                #attempt([a, a, a, x, x, x])

    if 0:
        for n, x in enumerate(ems[:200]):
            print(n, x['char'])
            for y in ems[n:200]:
                for z in ems[:200]:
                    if x != y and y != z and x != z:
                        attempt([x, y, z, z])

    # for x in have: for y in have: for z in have: attempt([x, y, z])

    print('done! missed:', len(ems) - len(have))

    print(' '.join(e['abbr'] + e['char'] for e in ems if e not in have))
    ofn = 'edges_%s_%s.json' % (len(ems), time.strftime('%y%m%d_%H%M%S'))
    open(ofn, 'w').write(json.dumps(edges))
    print('edges written to', ofn)


def repl():
    load()
    print_legend()
    while True:
        line = input().split()
        if not line:
            continue
        for a in line:
            if a not in abbr_ems:
                print('?', a)
                break
        else:
            es = [abbr_ems[a] for a in line]
            n = comb(es)
            print(Equation(line), '=', n['abbr'] + n['char'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-c',
                        '--create',
                        action='store_true',
                        help='write emoji.json')
    parser.add_argument('-p',
                        '--pack-svg',
                        action='store_true',
                        help='write emoji_svgs_*.json')
    parser.add_argument('-g',
                        '--generate',
                        action='store_true',
                        help='attempt to generate interesting equations')
    parser.add_argument('-r',
                        '--repl',
                        action='store_true',
                        help='open interactive equation repl')
    options = parser.parse_args()

    if options.create:
        create()
    if options.pack_svg:
        svg_pack.pack_svg()
    if options.generate:
        generate()
    if options.repl:
        repl()

    if not (options.create or options.generate or options.pack_svg
            or options.repl):
        parser.print_help()


if __name__ == "__main__":
    main()
