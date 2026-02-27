# SCE Errorbook Registry

Shared curated error/remediation knowledge registry for SCE projects.

## Repository Role

- Central cross-project errorbook knowledge base
- Curated entries only (`status=promoted`, `quality_score>=75` recommended)
- Optimized for remote indexed query (no full local sync required)

## Structure

```text
registry/
  errorbook-registry.json
  errorbook-registry.index.json
  shards/
    order.json
    payment.json
    auth.json
    *.json (auto-generated buckets)
```

## Governance Rules

- No sensitive tenant/customer data
- Temporary mitigation entries must include exit criteria, cleanup task, and deadline
- Prefer append-only via PR review; deprecate low-value entries rather than force-delete history

## Consumer Config Example

```json
{
  "enabled": true,
  "search_mode": "remote",
  "cache_file": ".sce/errorbook/registry-cache.json",
  "sources": [
    {
      "name": "central",
      "enabled": true,
      "url": "https://raw.githubusercontent.com/heguangyong/sce-errorbook-registry/main/registry/errorbook-registry.json",
      "index_url": "https://raw.githubusercontent.com/heguangyong/sce-errorbook-registry/main/registry/errorbook-registry.index.json"
    }
  ]
}
```

## Validation

GitHub Actions validates JSON structure and required fields on every push/PR.
- Coverage gate: index coverage must be >= 85% by default.

## Index/Shard Build

- `scripts/rebuild-index.js` is the canonical generator for:
  - `registry/errorbook-registry.index.json`
  - `registry/shards/*.json`
- It seeds three stable domain buckets (`order`, `payment`, `auth`) and adds dynamic buckets as entries grow.
- `registry-rebuild` workflow runs on `main` push (or manual trigger), rebuilds, validates, and commits generated changes.

Manual run:

```bash
node scripts/rebuild-index.js --write
node scripts/validate-registry.js
node scripts/check-index-coverage.js --min-coverage 85
```
