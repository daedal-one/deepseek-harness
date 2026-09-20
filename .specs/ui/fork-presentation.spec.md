---
id: REQ:ui/fork-presentation
type: requirement
status: accepted
level: MUST
summary: The Web interface uses the Daedal companion visual identity and explains the fork only on explicit request.
owners: [carlo]
refines: [REQ:ui/responsive-web-shell]
categorized_under: []
---

# Daedal fork presentation

:::{requirement id="fork-presentation" level="MUST"}
- {#c-theme} The Web shell MUST use the Daedal mark, green accents, and coordinated light and dark surfaces matching the Paseo companion fork through shared theme tokens.
- {#c-overview} The upper-left brand button MUST open an overview of implemented fork changes on its first and subsequent activations. The overview MUST credit upstream and MUST NOT appear automatically on startup or reload.
- {#c-accessibility} The overview MUST support keyboard opening, dismissal, focus restoration, and scrolling on phone-sized screens.
- {#c-onboarding} The application MUST NOT display the internal-testing notice or require its acknowledgement. Credential onboarding MUST retain its independent behavior.
:::
