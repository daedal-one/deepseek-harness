---
id: TASK:web/browser-authorization
type: task
status: accepted
summary: Keep browser authorization across ordinary navigation, restarts and active use.
owners: [carlo]
progress: done
addresses: ["REQ:web/browser-authorization#c-persistence", "REQ:web/browser-authorization#c-navigation", "REQ:web/browser-authorization#c-renewal", "REQ:web/browser-authorization#c-trust", "REQ:web/browser-authorization#c-evidence"]
---

# Remember browser authorization

## Plan

Reuse the durable signing secret and configured cookie lifetime. Use an explicit SameSite=Lax cookie so ordinary links can open an authenticated index. Renew only validated browser cookies on index responses and authenticated HTTP API responses, without giving device credentials browser-owner authority. Keep expired cookies and untrusted API requests rejected. Update the Connection documentation and authentication decision record.

## Validation

Use a controlled clock to prove continued access beyond the original expiry and refusal after inactivity, invalid credentials and secret replacement. Exercise renewal through the real Loader composition and preserve API trust and device-admission coverage. Reproduce external-link refusal with Strict cookies in an isolated browser, then verify navigation after a real server restart with Lax cookies. Run documentation checks, lint and specification validation. Production activation remains separate from local verification.

## Evidence

The six focused Connection, frontend and gateway test files pass 132 tests. The real CLI restart test passes with an isolated Harness home. An isolated browser reproduced the 401 on external navigation with Strict cookies, then opened the application from the same link after renewal and another server restart with Lax cookies. The Connection bundle builds, full lint passes and all 34 documentation gates pass. Specification validation reports seven existing historical `Spec-Ref: none` errors; the repository's spec-tree and baseline gates pass. No live server activation is included.
