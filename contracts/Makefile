# Contract interface and TypeScript type generation.
#
# Prefer `npm run generate:contract-types` from the repository root in CI and
# contributor workflows; it runs interface generation and TS codegen in order.

.PHONY: generate generate-interface

generate-interface:
	node scripts/generate-interface.mjs

generate:
	cd .. && npm run generate:contract-types
