# Security audit triage — 2026-10-21

Parent: https://github.com/Mike-Demo/appreciate-button-pixel/issues/1

Issue creation is unavailable in this session. The three sections below provide exact
issue titles and bodies ready to file in this repository. No remediation is implemented.
The audit was static source inspection only; no exploit was executed or deployed
endpoint probed. Source references below use absolute repository paths and line ranges.

## Prioritized backlog

| Order | Exact issue title | Risk and fix rationale |
| --- | --- | --- |
| 1 | `[security][medium] Prevent User-Agent rotation from refreshing visitor allowances` | An unauthenticated caller with a public button key can inflate totals and leaderboard rank by changing a request header. Coarsening the header is a small, local mitigation, but not a durable identity guarantee. |
| 2 | `[security][low] Bound item and visitor-row accumulation on clicks` | The same public route lets a caller grow persistent database state with novel item identifiers, even without rotating visitor identity. An atomic creation ceiling is localized, but retention and compatibility require more care than header normalization. |
| Validation queue | `[security][needs-validation] Audit leads to validate` | Three unconfirmed leads, with no severity assigned; deployment or browser evidence is required before promotion. |

The two confirmed findings have distinct root causes and must remain separate issues:
visitor-identity instability versus unbounded accumulation. They share an unauthenticated
entry point and can amplify each other, but fixing either does not resolve the other.
Per-IP rate limiting bounds request rate, not lifetime allowances or retained row count;
its store is per process, not a deployment-wide hard limit.

## Issue 1

### Exact title

`[security][medium] Prevent User-Agent rotation from refreshing visitor allowances`

### Body

Parent audit: https://github.com/Mike-Demo/appreciate-button-pixel/issues/1

Status: confirmed by static inspection. Priority: first confirmed remediation.
Fingerprint: `visitor-cap-bypass-via-user-agent-rotation`

#### Evidence and reachability

- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/routes/public.ts:332-354`
  exposes unauthenticated `POST /v1/buttons/:publicKey/click` and forwards the derived visitor hash.
- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/routes/public.ts:179-184`
  passes the source IP and verbatim `User-Agent` into `hashVisitor`.
- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/lib/visitor-hash.ts:36-44`
  HMACs those inputs without normalizing the header.
- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/lib/guarded-increment.ts:105-147`
  creates a fresh visitor row at zero, conditionally increments it, then increments the
  item total in the same transaction. A new hash therefore receives a fresh allowance.
- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/routes/public.ts:139-160`
  allows requests without `Origin`; a scripted client can also choose its own header.
  Origin enforcement is not caller authentication.
- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/routes/leaderboard.ts:141-149`
  sums item totals and orders tenants by those totals, propagating inflation into rank.

At a fixed IP, a non-browser caller with a public button key can rotate arbitrary
User-Agent strings to refresh the per-visitor allowance repeatedly. This compromises
counter integrity without tenant credentials. It does not mean unlimited throughput:
the public route registers per-IP throttling at
`/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/routes/public.ts:203-209`;
the process-local store and IP key are documented/implemented at
`/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/lib/rate-limit.ts:19-33`.

#### Root cause

Visitor identity depends solely on IP and a freely chosen, unnormalized User-Agent.
An HMAC protects the stored inputs but does not make a client-controlled input trustworthy.

#### Smallest fix and limits

Normalize/coarsen User-Agent to browser family plus major version before hashing in
`visitor-hash.ts`, with a stable fallback for unknown, malformed, or absent headers.
Do not fall back to hashing raw unknown strings. Correct the claim in that file that
clients cannot choose User-Agent, and document the shared-IP/browser tradeoff and that
scripted callers remain bounded only by the per-IP request budget.

This is a partial mitigation: callers can still select different recognized browser
families or major versions. Do not describe normalization as a complete bypass fix.
The structural follow-up is a server-issued signed visitor token with an explicit
issuance/reissuance policy: missing or invalid tokens must not automatically mint a
fresh allowance. A freely renewable signed token alone does not solve the problem.

#### Proposed acceptance checks

- [ ] Same-IP User-Agent variants within a browser family/major share a hash and allowance.
- [ ] Unknown, malformed, and missing headers use a stable fallback rather than new identities.
- [ ] Existing cap concurrency guarantees and keyed hashing are preserved.
- [ ] Document remaining spoofability, NAT collisions, per-process rate-limit scope, and any
      rollout effect on existing stored visitor hashes.
- [ ] If claiming full remediation rather than mitigation, demonstrate that token omission,
      tampering, or repeated issuance cannot refresh the allowance.

## Issue 2

### Exact title

`[security][low] Bound item and visitor-row accumulation on clicks`

### Body

Parent audit: https://github.com/Mike-Demo/appreciate-button-pixel/issues/1

Status: confirmed by static inspection. Priority: second confirmed remediation.
Fingerprint: `unbounded-item-row-creation-via-click-api`

#### Evidence and reachability

- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/routes/public.ts:332-354`
  accepts an unauthenticated caller's `item` and invokes `incrementClick`.
- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/lib/url-normalize.ts:25-48`
  trims and length-checks item identifiers but passes non-URL values through unchanged.
  A per-string length limit does not limit the number of distinct identifiers.
- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/lib/guarded-increment.ts:98-147`
  inserts both item and visitor rows before the conditional visitor-cap update.
  With a novel item and `maxClicks >= 1`, that update succeeds and the transaction commits.
- `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/db/migrations/003_items.sql:5-11`
  keys items by button and item; `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/db/migrations/004_visitor_clicks.sql:2-9`
  keys visitor rows by button, item, and visitor hash. These schemas impose no per-button
  cardinality ceiling or automatic expiry.

A caller with a public key can submit successive novel item strings and retain a new
item row and visitor row per accepted click, even with a constant visitor hash.
Per-IP throttling slows accumulation but does not bound persistent storage over time.
This is a resource-consumption risk; no deployed exhaustion or outage was demonstrated.

#### Root cause

`attemptIncrement` creates rows for every new button/item/visitor triple without an
accumulation bound. The visitor click cap applies to each triple, not to distinct-item
count, and there is no retention policy for these tables.

#### Smallest fix and limits

Enforce a per-button distinct-item ceiling at the insert point in `guarded-increment.ts`.
Reject creation beyond the ceiling through the existing bad-request error mechanism,
before creating either row, while continuing to allow clicks on existing items.
Make checking and reserving capacity atomic across concurrent requests/processes;
an unlocked count followed by an insert is insufficient.

Add a bounded retention job for eligible stale or zero rows, with an explicit retention
policy for totals and visitor allowances. Deleting active visitor records would refresh
allowances, so cleanup must not silently weaken the cap. An item ceiling alone also
does not bound visitor identities on existing items; address that residual growth with
the retention policy and coordinate with the separate visitor-identity issue.

Optionally restrict URL-shaped items to the button's allowed origins, but do not treat
this as a cardinality bound: an allowed origin still has arbitrarily many paths.
Preserve supported opaque item identifiers unless deliberately changing that contract.

#### Proposed acceptance checks

- [ ] At the ceiling, novel items return a bad request without retaining either new row.
- [ ] Concurrent novel-item requests cannot exceed the ceiling, including across processes.
- [ ] Existing items remain clickable and retain the existing atomic visitor-cap behavior.
- [ ] Retention has a bounded batch size and explicit stale/zero eligibility rules; it
      preserves active allowances and handles related rows consistently.
- [ ] Document the chosen ceiling, retention window, and treatment of existing over-limit buttons.

## Issue 3

### Exact title

`[security][needs-validation] Audit leads to validate`

### Body

Parent audit: https://github.com/Mike-Demo/appreciate-button-pixel/issues/1

These are unconfirmed leads, not confirmed vulnerabilities. No severity is assigned.
Record the missing deployment/browser facts before promoting or rejecting each lead.
Use authorized local fixtures only; do not probe deployed endpoints or third-party pages.
The missing facts below are quoted verbatim from the parent issue. Its two SVG
statements are truncated; obtain their unabridged wording before claiming full validation.

- [ ] **docker-compose.yml ships known MySQL root and application credentials and publishes port 3306 on all interfaces**
  - Fingerprint: `docker-compose-known-mysql-credentials-published-port`
  - Claimed root cause: Committed compose configuration reuses publicly known credentials for privileged and application MySQL users and binds the database port on all interfaces instead of loopback or an environment-supplied secret.
  - Source: `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/docker-compose.yml:5-11` (credential settings and unqualified port publishing; credential values intentionally not reproduced here).
  - **Exact missing fact:** Whether any operator runs this docker-compose.yml (or copies its environment block or credential values) on a host where port 3306 is reachable by lower-trust parties (LAN or internet-facing VPS without a firewall).
  - Validation record: Obtain operator confirmation of deployment usage and effective network/firewall exposure without collecting credentials. Record evidence and disposition.

- [ ] **Widget sanitizer does not strip SMIL animate elements, so an href-rewriting animation the server guard misses reaches embedding pages**
  - Fingerprint: `svg-smil-animate-href-rewrite-not-stripped-by-widget`
  - Claimed root cause: Server raw-string regex misses xlink:href and entity-encoded attributeName spellings, and the widget sanitizer neither forbids animate elements nor inspects animation attributes that rewrite href or xlink:href.
  - Sources: `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/lib/svg-guard.ts:25-37` and `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/widget/src/sanitize-svg.ts:10-12,40-74`.
  - **Exact missing fact:** Whether current browsers apply an SMIL animation of href or xlink:href (attributeName decoded from an entity-encoded spelling) on an a or image element inside inline SVG inserted via importNode into a ShadowRoot, such that a subsequent user click follows the animated value, in particular a javascript: target executing in the embedding page origin …
  - Validation record: Recover the truncated ending; use an isolated embedding fixture through both actual guards. Record browser/version, CSP, decoded attributes, animation result, click behavior, execution origin if any, and disposition. Passing static filtering alone does not establish execution.

- [ ] **Tenant SVG style element survives both sanitizers and can style the widget shadow tree**
  - Fingerprint: `svg-style-element-css-injection-into-embedding-pages`
  - Claimed root cause: Both SVG defence layers omit the style element, so tenant-supplied CSS text reaches the widget shadow tree unsanitized.
  - Sources: `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/server/src/lib/svg-guard.ts:25-37` and `/home/runner/work/appreciate-button-pixel/appreciate-button-pixel/packages/widget/src/sanitize-svg.ts:10-12,40-74`.
  - **Exact missing fact:** Whether a current browser (a) fetches @import or url() resources referenced by an SVG style element inserted via importNode into a ShadowRoot, sending the embedding page URL as Referer, and/or (b) applies in-shadow-tree rules targeting the svg element itself (position fixed, inset 0, viewport width and height) so the widget paints a viewport-cover…
  - Validation record: Recover the truncated ending; use an isolated fixture and local resource receiver. Record browser/version, CSP and Referrer-Policy, actual requests and Referer, computed geometry and paint behavior, and separate dispositions for (a) and (b). Do not infer page-wide styling or URL disclosure solely from style-element survival.
