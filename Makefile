.PHONY: dist

dist:
	./svg_pack.py
	webpack --mode=production
