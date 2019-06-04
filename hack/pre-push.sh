#!/bin/bash
md5sum -c <(echo "$(gsutil hash -hm gs://smilecraft/emoji.json | grep -o '\S\{32\}') data/emoji.json")
