# Keep a working Harness during local development

The local recovery proxy keeps one loopback Web address available while you develop the Harness. Its recovery page can stop the development backend and start a retained, committed version that you have used to edit code. It supports macOS and Linux with Node 22.19 or newer and an installed pnpm.

## Install and start

1. From the repository, install the independent supervisor:

   ```sh
   node scripts/dev-proxy.ts install
   ```

   Installation copies the supervisor into `~/.local/share/dsh-dev-proxy`, with a private configuration, recovery token, and the install-time command search path for service-manager launches. It refuses to overwrite an existing installation. `--state`, `--repository`, `--home`, `--port`, and `--pnpm` replace the defaults. Repeat `--trusted-host` for the plain DNS names or IP addresses through which Tailscale reaches this server; each is also passed to the Harness.

2. Stop any existing Harness service on port 3080, then run the installed supervisor:

   ```sh
   node "$HOME/.local/share/dsh-dev-proxy/dev-proxy.ts" serve
   ```

   The proxy binds `127.0.0.1:3080` before starting the backend. It builds the current checkout, then launches its built `dsh --profile web` entry on an automatically assigned loopback port. The recovery page stays available during builds and after backend failure. A service manager must run the installed supervisor instead of the checkout's CLI; only the supervisor owns backend restarts. The existing Tailscale TCP route can continue forwarding to port 3080.

3. Open the private recovery URL printed at startup. It exchanges its token for an HTTP-only recovery cookie and removes the token from the address bar. **Open harness** performs the separate Harness authentication handoff. For a trusted Tailscale address, replace the recovery URL's authority with that address and its forwarded port, retaining the path and token. Keep the complete token URL private.

## Retain and recover

Start **Use current** from a clean committed checkout. Use that running version to make a real code edit in a scratch workspace or another project. On the recovery page, check the code-edit confirmation and choose **Mark current good**. Changes to the Harness checkout itself require a commit and another **Use current** before marking; the marker never attributes a dirty or rebuilt runtime to `HEAD`.

Marking clones the recorded commit into a separate repository, installs its locked dependencies, and copies the actual running build artifacts. Artifact fingerprints before and after copying reject concurrent rebuilds. A failed preparation leaves the existing last-good record intact. The retained copy does not depend on the development checkout's Git objects, build directories, or workspace dependency links.

When development breaks, open `/_dev` at the same public address and choose **Use last good**. Switching stops the current process tree, waits for it to exit, and starts the retained version against the same Harness home and working repository. Reopen the Harness to load its matching frontend and reconnect streams. **Use current** builds and selects the working checkout again. Supervisor restarts retain the last explicit selection. Backend failures never select another version automatically.

After updating the installed supervisor, reopen `/_dev` before submitting a recovery action so the browser loads the current page and its response headers.

`GET /_dev/status` returns the selected version, process state, last-good commit, and current operation. `POST /_dev/use-good`, `POST /_dev/use-current`, and `POST /_dev/mark-good` perform the page's actions; marking requires the form field `edited=yes`. These routes accept the recovery cookie or `Authorization: Bearer <recovery-token>` and check Host and browser Origin. Operations are exclusive, except that **Use last good** can interrupt a pending build or retention operation when a good build exists. Accepted actions redirect to the recovery page; status reports their eventual result.

## Limits and troubleshooting

Switching interrupts active work. It never retries a request, reverses file edits, or downgrades persisted data. An older version can refuse a session written in a newer format; use disposable data for storage-format experiments. Both versions use the same personal settings and profile configuration, so this fallback does not undo edits to custom plugins or configuration outside the retained checkout.

The state directory contains private `backend.log`, `build.log`, and `retain.log` files. Backend logs contain the Harness login URL and must remain private. `good.json` identifies the retained build. Failed startup leaves the recovery page usable; inspect the owning log before explicitly retrying. Retained build directories consume disk space; only the directory named by `good.json` is needed after the supervisor and its children are stopped.

The proxy supports HTTP bodies, streamed responses, and WebSocket upgrades. The Harness still owns application authentication and browser trust checks. The recovery control is a separate capability: exposing the listener through Tailscale does not make its private token unnecessary.

See the [local recovery decision](../../.agents/notes/implemented/process/2026-09-14-local-development-recovery.md) for the recovery boundary and validation evidence, and [Session persistence limits](../../packages/session/session-persistence-jsonl/README.md#known-limitations-and-deferred-work) for format compatibility.

## Dev Note

None.
