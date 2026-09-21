---
id: REQ:sandbox/development-vm
type: requirement
status: accepted
level: MUST
summary: Give each conversation a private Linux VM with Docker, persistent development services, browser testing, and isolated previews.
owners: [carlo]
refines: []
categorized_under: []
---

# Development VM

:::{requirement id="development-vm" level="MUST"}
- {#c-world} An opt-in VM provider MUST give each conversation a private hardware-virtualized Linux guest, bounded CPU, RAM, disk, and lifetime. Ordinary filesystem, subprocess, terminal, and search consumers MUST share that conversation's canonical `/workspace`. The source checkout and host engine sockets MUST NOT be mounted in the guest.
- {#c-docker} The guest MUST support Docker Engine, Docker Compose, image builds, bind mounts within its workspace, service DNS, and named volumes. Guest Docker authority MUST end at the VM. Docker storage MUST have a separate durable quota from memory-backed source storage.
- {#c-network} Host-enforced networking MUST reject guest access to host services, private networks, metadata, and other conversations, including alternate IPv4 and IPv6 routes. Dependency and image downloads MAY use explicitly configured public egress. The guest MUST NOT control the enforcing rules.
- {#c-settle} Successful-turn Git settlement MUST close mutation admission and establish a hypervisor-enforced source-writer barrier without requiring development services to exit. Only trusted maintenance may write during that barrier. Failed settlement MUST retain a recoverable state and MUST NOT silently reopen writes.
- {#c-recovery} Private durable recovery MUST associate the source checkpoint with the VM's durable development data. Recovery MUST retain Docker images and named-volume data without exporting them through Git. Normal process shutdown MUST NOT delete retained conversation data.
- {#c-browser} A browser inside the guest MUST be able to test guest services. User-facing previews MUST authenticate access, use an origin distinct from the Harness control plane, support WebSockets, and target only the requesting conversation's approved guest ports.
- {#c-agent} Provisioning, pause, recovery, and Git return MUST remain transparent to the coding agent. Existing granular-commit guidance and the message-only fallback model MUST remain the only workspace-management prompting.
- {#c-evidence} Acceptance MUST execute a real imported repository, Docker build, Compose application plus database, browser assertion, successful turn while services remain running, immutable host Git return, and restart with database data intact. Negative tests MUST prove host/socket/network isolation and failed-barrier behavior. Shipped profiles MUST remain unchanged until this evidence passes.
:::
