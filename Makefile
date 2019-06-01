.PHONY: dist

dist:
	python emoji.py --create --pack-svg
	webpack --mode=production
