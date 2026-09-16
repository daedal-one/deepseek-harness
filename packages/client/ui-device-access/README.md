---
description: "Pair Daedal DSH devices through a browser-owned QR and revoke their access from DSH Web Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-device-access

## Summary

The **Devices** section lets a browser owner pair Daedal DSH on an iPhone and revoke an enrolled device. Pairing uses a short-lived, single-use QR instead of transferring the browser credential. Device access can be removed independently while Sessions keep running. The browser must reach the same Host through an address the phone can use.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open **Settings → Devices** in an authenticated DSH Web page. **Create pairing QR** displays a code for that page's Host and address. In Daedal DSH on iPhone, open **Settings → DSH hosts → Scan pairing QR**, review the Host, and confirm. Keep the QR private. A loopback address cannot reach another computer from a physical phone; open the page using its private-network address before creating the code.

**Refresh devices** reads the current enrolled devices. Select **Revoke access…**, check the selected device, and confirm **Revoke device access** to close its authenticated connections and prevent reconnection. Revocation does not stop Sessions or undo accepted operations. A lost revocation response disables further mutations until a refresh reconciles the device list.

The Web bundle mounts this plugin through its `cordis.patch.yml` row. The plugin has no configuration fields; Connection owns device-access policy. Private desktop, worker and fixture transports do not acquire browser device-administration authority.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[Connection](../connection/README.md#device-enrollment) owns same-origin administrative requests and a generation-bound observable. The [entry](src/client/index.ts) contributes a localized Settings section and injects plain actions plus that source; the renderer supplies the selector hook. The [component](src/client/DeviceSettings.tsx) keeps only revocation-confirmation state locally and renders QR graphics through `qrcode.react`. Plugin activation makes no request.

Closing the section, hiding the page, disconnecting, disposal or challenge expiry erases QR material from the browser state. Cancelling a browser request cannot retract a challenge already created on the Host; hiding a code leaves it valid until expiry or first claim. Neither credentials nor challenges are persisted by this package. Only reads refresh automatically after a generation change; mutations require a gesture.

No invariant companion is published: the section projects one Connection-owned source and registers through the slot lifecycle, with no independently owned relationship to assert.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Connection](../connection/README.md#device-enrollment) — authorization, enrollment lifetime and revocation.
- [Settings](../ui-settings/README.md) — section composition and shell ownership.
- [Device-access decision](../../../.agents/notes/implemented/architecture/2026-09-16-device-enrollment-and-revocation.md) — credential separation and uncertain outcomes.

-----

<a id="model-experience"></a>
## Model Experience

None, as browser device administration contributes no model inputs or Session events.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Pairing and administration retain these access constraints:

- Device administration requires an ordinary authenticated Web page and enabled Host device access; a device bearer cannot administer other grants.
- The QR carries the current page origin. Reachability and private-network access remain prerequisites; the section does not configure networking or discover other Hosts.
- Device metadata refreshes on selection, explicit refresh and connection generation changes. A successful claim from another device does not push a list update.
- Hiding a QR does not invalidate its challenge on the Host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
