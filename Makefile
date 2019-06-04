.PHONY: dist vec

dist: data/emoji.json
	./svg_pack.py
	webpack --mode=production

data/tweets_vec_emoji.txt data/emoji.json:
	curl -fsSL https://storage.googleapis.com/smilecraft/$(notdir $@) > $@.tmp
	mv $@.tmp $@


GloVe/build/glove:
	$(MAKE) -C GloVe

ITERS = 50

vec: tweets GloVe/build/glove
	awk '!x[$$1]++' tweets | cut -d' ' -f 4- | sed 's-\(https\?://[^/]*\)\S*-\1-g' | tr -d "\"'!,." | python3 -c "import re,json,sys; r=re.compile('(%s)' % '|'.join(c['char'] for c in json.load(open('data/emojitracker_rankings.json')))); sum(print(r.sub(r' \1 ', l.lower()).strip()) or 1 for l in sys.stdin)" > tweets_filter
	GloVe/build/vocab_count -min-count 10 < tweets_filter > tweets.vocab
	GloVe/build/cooccur -memory 2 -vocab-file tweets.vocab -window-size 15 < tweets_filter > tweets.coocur
	GloVe/build/shuffle -memory 2 < tweets.coocur > tweets.coocur.shuf
	GloVe/build/glove -save-file tweets.vec -threads 4 -input-file tweets.coocur.shuf -x-max 100 -iter ${ITERS} -vector-size 300 -vocab-file tweets.vocab -binary 2
	python3 -c "import re,json,sys; r=re.compile('(%s)' % '|'.join(c['char'] for c in json.load(open('data/emojitracker_rankings.json')))); sum(print(l.strip()) or 1 for l in sys.stdin if r.match(l))" < tweets.vec.txt > data/tweets_vec_emoji.txt

push_data:
	gsutil cp -Z -a public-read data/tweets_vec_emoji.txt data/emoji.json gs://smilecraft/
