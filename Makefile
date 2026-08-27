# TODO: set caddy site root in the line below:
SITE_ROOT ?= /var/www/html

.PHONY: copy
copy:
	mkdir -p $(SITE_ROOT)/.assets
	cp sidecar/{heic.js,libheif-bundle.js,heic.worker.js} $(SITE_ROOT)/.assets/