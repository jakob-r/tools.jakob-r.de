.PHONY: dev check build install

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
