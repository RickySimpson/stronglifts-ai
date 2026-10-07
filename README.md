# RackCity

A small, inventory-aware barbell plate calculator. Open `index.html` through a local HTTP server or use the hosted site. No build step or dependencies are required.

The calculator supports pounds and kilograms with separate equipment settings. When a target is unavailable, it offers the nearest achievable lower and higher loads. Equipment can be collapsed below the target and result.

Select the units printed on your plates. KG mode uses kilogram-labeled plates and defaults to a 20 kg bar; it does not convert pound equipment. Exactly 1 lb = 0.45359237 kg, so 45 lb is approximately 20.41 kg, not 20 kg. Bar weights can be entered to two decimal places (for example, 20.41 kg for a nominal 45 lb bar used with kilogram plates). Converting pound-labeled plates into a metric inventory is not supported.

Changes are cached immediately for the current user and synchronized to the configured API. Failed saves remain pending locally and retry with backoff or the Retry button. The initial screen renders before the network request completes. Storage failures are handled without blocking calculation.

Run regression checks with Node.js:

```sh
node --test calculator.test.cjs
```

Tests use isolated storage and a mocked API; they do not write production data. They cover calculation boundaries, inventory constraints, invalid saved data, cache migration, startup edits, serialized saves, failed-save recovery, and request timeouts.

The API backend is maintained separately. Server-side authorization and cross-device atomic conflict handling cannot be implemented in this static frontend alone. A `uid` identifies saved data; it should not be treated as authentication.
