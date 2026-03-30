# Hydration Profiling Results — 2026-03-29

## Context

The architecture hardening plan originally proposed switching `AddToCartButton` from `client:idle` to `client:visible` to reduce hydration overhead on menu pages. A debate review challenged whether this would have measurable impact. This profiling task was added to make a data-driven decision.

## Lighthouse Results (localhost, menu page `/nl/`)

| Metric                             | Value    | Threshold | Status            |
| ---------------------------------- | -------- | --------- | ----------------- |
| **Performance Score**              | 79       | -         | -                 |
| **TBT (Total Blocking Time)**      | **34ms** | < 200ms   | Well under        |
| **FCP (First Contentful Paint)**   | 1.9s     | -         | SSR response time |
| **LCP (Largest Contentful Paint)** | 5.2s     | -         | Image loading     |
| **CLS**                            | 0        | -         | No layout shift   |
| **Speed Index**                    | 2.8s     | -         | -                 |

## Main Thread Breakdown

| Category             | Duration |
| -------------------- | -------- |
| Other                | 476ms    |
| Script Evaluation    | 143ms    |
| Style/Layout         | 138ms    |
| GC                   | 32ms     |
| Paint/Composite      | 28ms     |
| HTML Parse           | 23ms     |
| Script Parse/Compile | 15ms     |

## Decision

**Hydration optimization deferred — not warranted.**

- TBT is 34ms (well under the 200ms threshold)
- Script evaluation is 143ms total, of which island hydration is ~81ms
- The real bottleneck is LCP (5.2s) driven by image loading and FCP (1.9s) driven by SSR response time
- Switching `client:idle` → `client:visible` would save a fraction of the 81ms hydration time for below-fold cards — imperceptible to users

**Higher-impact optimizations to consider instead:**

- Image optimization / preloading for LCP improvement
- SSR response time optimization (API call waterfall in middleware)
- Lazy-loading SDK calls (defer `ensureCart` until user interaction)
