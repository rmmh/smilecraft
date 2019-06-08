.PHONY: dist vec tweets_filter tweets.vocab

dist: data/emoji.json
	./svg_pack.py
	webpack --mode=production

GCS_PATH = gs://smilecraft
GCS_PATH_HTTP = https://storage.googleapis.com/smilecraft
GSUTIL_CP = gsutil -h "Content-Type:text/plain" -h "Cache-Control:no-cache" -q cp -a public-read

data/tweets_vec_emoji.txt data/emoji.json:
	curl -fsSL ${GCS_PATH_HTTP}$(notdir $@) > $@.tmp
	mv $@.tmp $@


GloVe/build/glove:
	$(MAKE) -C GloVe

ITERS = 100
MINCOUNT = 50

tweets_filter:
	pv tweets | go run tweet_clean.go > tweets_filter

tweets.vocab:
	GloVe/build/vocab_count -min-count ${MINCOUNT} < tweets_filter > tweets.vocab

tweets.coocur: tweets.vocab
	GloVe/build/cooccur -memory 2 -vocab-file tweets.vocab -window-size 15 < tweets_filter > tweets.coocur

vec: tweets.coocur tweets.vocab GloVe/build/glove
	GloVe/build/shuffle -memory 2 < tweets.coocur > tweets.coocur.shuf
	GloVe/build/glove -save-file tweets.vec -threads 4 -input-file tweets.coocur.shuf -x-max 100 -iter ${ITERS} -vector-size 300 -vocab-file tweets.vocab -binary 2
	python3 -c "import re,json,sys; r=re.compile('(%s)' % '|'.join(c['char'] for c in json.load(open('data/emojitracker_rankings.json')))); sum(print(l.strip()) or 1 for l in sys.stdin if r.match(l))" < tweets.vec.txt > data/tweets_vec_emoji.txt

push_data:
	${GSUTIL_CP} data/tweets_vec_emoji.txt data/emoji.json ${GCS_PATH}
	cat data/tweets_vec_emoji.txt | tr ' ' '\t' | cut -f 2- | ${GSUTIL_CP} - ${GCS_PATH}/tweets_vec.tsv
	cat data/tweets_vec_emoji.txt | tr ' ' '\t' | cut -f 1 | ${GSUTIL_CP} - ${GCS_PATH}/tweets_vec_metadata.tsv
	echo '{"embeddings":[{"tensorName":"Tweet Emoji","tensorShape":[1000,50],"tensorPath":"${GCS_PATH_HTTP}/tweets_vec.tsv","metadataPath":"${GCS_PATH_HTTP}/tweets_vec_metadata.tsv"}]}' | ${GSUTIL_CP} - ${GCS_PATH}/tweets_vec_proj_conf.json
	@ echo Serving at https://projector.tensorflow.org/?config=${GCS_PATH_HTTP}/tweets_vec_proj_conf.json
