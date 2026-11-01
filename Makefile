.PHONY: dev check build install og

install:
	cd frontend && pnpm install

frontend/node_modules: frontend/package.json frontend/pnpm-lock.yaml
	cd frontend && pnpm install
	@touch frontend/node_modules

dev: frontend/node_modules
	cd frontend && pnpm dev

check: frontend/node_modules
	cd frontend && pnpm check

build: frontend/node_modules
	cd frontend && pnpm build

CHROME ?= /Applications/Google Chrome.app/Contents/MacOS/Google Chrome

# Render the share image (og:image) from og/og.html
og:
	"$(CHROME)" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
		--window-size=1200,630 --allow-file-access-from-files \
		--screenshot="$(CURDIR)/frontend/static/og.png" "file://$(CURDIR)/og/og.html"
