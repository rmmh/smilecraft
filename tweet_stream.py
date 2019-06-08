#!/usr/bin/env python3
# this is based on http://adilmoujahid.com/posts/2014/07/twitter-analytics/

import collections
import json
import html
import os
import re
import sys
import queue
import threading

import tweepy
import tweepy.api
import tweepy.streaming

conf = json.load(open(os.environ['TWITTER_CONFIG']))
access_token = conf['access']
access_token_secret = conf['access_secret']
consumer_key = conf['consumer']
consumer_secret = conf['consumer_secret']


def get_text(d):
    if d.get('extended_tweet'):
        d = d['extended_tweet']
        t = d['full_text']
    else:
        t = d.get('text')
        assert not t or not d['truncated']
    if not t:
        return
    for m in d.get('entities', {}).get('media', []):
        if m.get('url'):
            t = t.replace(m['url'], m['expanded_url'])
    for m in d.get('entities', {}).get('urls', []):
        t = t.replace(m['url'], m['expanded_url'])
    return t.replace('\n', '\t')


class Listener(tweepy.streaming.StreamListener):
    def __init__(self, ems, rare_thresh=100):
        self.f = open('tweets', 'a')
        self.frol = open('/dev/shm/tweets_recent', 'a')
        self.set_rare_regex(ems[rare_thresh:])
        self.queue = queue.Queue(maxsize=1000000)
        threading.Thread(target=self.run, daemon=True).start()

    def set_rare_regex(self, ems):
        self.rare_ems_re = re.compile(r'(%s)' % '|'.join(e for e in ems))

    def run(self):
        seen_ids = collections.OrderedDict()
        n = 0
        while True:
            try:
                data = self.queue.get(block=True)
            except:
                import traceback
                traceback.print_exc()
            if data is None:
                break
            try:
                d = json.loads(html.unescape(data))
            except json.JSONDecodeError:
                open('tweets_corrupt', 'a').write(data)
                d = json.loads(data)

            t = get_text(d)
            if not t:
                print(d)
                continue

            if self.frol.tell() > 10e6:
                self.frol.seek(0)
                self.frol.truncate()
            self.frol.write(data)
            if d['id'] in seen_ids:
                continue
            if d.get('retweeted') or t.startswith('RT @'):
                continue

            seen_ids[d['id']] = True
            if len(seen_ids) > 10000:
                seen_ids.popitem(last=False)

            e = [d['id'], d['timestamp_ms'], d['user']['screen_name'], t]
            if self.rare_ems_re.search(t):
                print('%8d' % n, *e)
            print(*e, file=self.f)
            n += 1

    def on_data(self, data):
        self.queue.put(data)
        return True

    def on_error(self, status):
        print(status)
        return False


if __name__ == '__main__':
    rank = json.load(open('data/emojitracker_rankings.json'))
    ems = [x['char'] for x in rank]
    ems_counts = {e: 0 for e in ems}

    l = Listener(ems, 200)
    auth = tweepy.OAuthHandler(consumer_key, consumer_secret)
    auth.set_access_token(access_token, access_token_secret)

    if sys.argv[-1] == 'search':
        vec_have = {l.split()[0] for l in open('data/tweets_vec_emoji.txt')}
        missed = [e for e in ems if e not in vec_have]
        api = tweepy.API(auth)
        for x in range(len(missed)):
            for tw in tweepy.Cursor(api.search,
                                    q=' OR '.join(missed[x:x + 1]) +
                                    ' -filter:replies -filter:nativeretweets',
                                    count=100,
                                    until='2019-06-01',
                                    lang='en',
                                    tweet_mode='extended').items(1500):
                t = get_text(tw._json)
                if not t:
                    continue
                if not any(m in t for m in missed):
                    continue
                e = [
                    tw.id,
                    int(tw.created_at.timestamp() * 1000), tw.user.screen_name,
                    t
                ]
                print(*e)
                print(*e, file=l.f)
                l.f.flush()
        sys.exit(0)

    #a = slice(None, 20)
    #a = slice(40, 70)
    a = slice(40, 440)
    # a = slice(50, 150)  # try to collect some rarer stuff
    b = slice(a.stop, a.stop + 400)

    if sys.argv[-1] == 'freq':
        for line in open('tweets.vocab'):
            w, c = line.split(' ')
            if w in ems_counts:
                ems_counts[w] = int(c)
        ems.sort(key=ems_counts.get)
        print('monitoring', ' '.join(ems[:800]))
        a = slice(0, 780, 2)
        b = slice(1, 780, 2)
        print(sorted(ems_counts.items(), key=lambda x: x[1])[:780])
        l.set_rare_regex(ems[:400])

    stream = tweepy.Stream(auth, l, tweet_mode='extended')
    stream2 = tweepy.Stream(auth, l, tweet_mode='extended')

    stream.filter(track=ems[a], languages=['en'], is_async=True)
    stream2.filter(track=ems[b], languages=['en'], is_async=True)
