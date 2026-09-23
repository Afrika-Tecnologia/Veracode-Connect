# Test Feature — 1.5.1

Scope: `release/1.5.1` against `main`.

Verdict: PASS. `npm test` completed with 203 passed, 0 failed. `git diff --check` passed.

Critical cases covered: empty Python alongside valid JavaScript; nonempty Python remains selected; empty HTML, test, ZIP and native artifacts remain unselected; weak source with content remains eligible through the coverage guard; mixed valid and proven unscannable results succeed; real-source errors and all-unscannable results fail without a synthetic `results.json`.

Limit: no live Veracode scan was run for this release candidate.
