---
id: REQ:sandbox/host-maintenance
type: requirement
status: accepted
level: MUST
summary: Allow deliberate host maintenance through an explicitly unconfined launch profile.
owners: [carlo]
refines: []
categorized_under: []
---

# Host maintenance

:::{requirement id="host-maintenance" level="MUST"}
- {#c-profile} A launch profile MUST accept an optional boolean `sandbox` setting. Omission and `true` MUST preserve configured behavior. `false` MUST select the existing `danger-full-access` sandbox and permission defaults for host-backed profiles without changing another profile or the process environment. Existing session permission records and explicit user settings remain authoritative.
- {#c-world} Disabling the host file sandbox MUST NOT move a container or remote execution world onto the host. Unsupported compositions MUST reject the option with an actionable error before boot. Host maintenance MUST use a separately launched host-backed profile unless the operator explicitly admits a trusted host-backed conversation preset in a mixed Host. A mixed Host MUST keep ordinary conversations in their configured container worlds and MUST reject an admitted preset that lacks matching host filesystem and subprocess providers.
- {#c-composition} Configuration dumps, initial boot, and live patch reload MUST apply the same profile option after user overlays. The option MUST remain fixed until relaunch.
- {#c-handoff} Documentation MUST distinguish launch profiles from conversation presets, explain existing agent approval requests, and state that agents cannot switch an active conversation's execution world through a permission change.
- {#c-deployment} Deployment MUST preserve the active companion capabilities and a known working release. Activation MUST verify the actual systemd command and authenticated readiness; a failing candidate MUST NOT strand the operator without the previous working service. Automatic rollback MUST account for persisted Session compatibility.
- {#c-evidence} Focused tests MUST cover configuration validation, unchanged defaults, host-mode composition, container rejection, and actual host file/process behavior. Release acceptance MUST include the deployed revision and authenticated service checks.
:::
