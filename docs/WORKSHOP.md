# Workshop declaration and evidence boundary

This document describes the author-declared installation and permission model for the fixed `7d7d`
source. It is input to Workshop review; it is not an RC.6 verification report or Registry admission.

## Integration type

- Protocol: `harness-profile`
- Adapter: `profile-bundle`
- Artifact: `cordis.patch.yml`
- Activation: restart the candidate Profile; hot reload is not claimed
- Failure policy: discard a failed candidate and restore the previous Profile generation

The adapter must install the fixed Git source into an ephemeral candidate Profile with package
lifecycle scripts disabled. Before activation it must prove that the current Profile is unchanged.
Removal must delete the package and reconcile the bundle list. Recovery must restore the previous
generation byte-for-byte. These statements define required tests; they do not assert those tests passed.

`7d7d` is a Web UI extension, so the candidate must be composed on the exact
`@deepseek-ai/dsh-web-app@0.1.0-rc.6` bundle. A bare Profile does not provide the `webServer` and
client-slot services that the plugin declares as peers. The Harness must record that Web base in its
plan and must not interpret a bare-Profile service wait as a plugin failure.

## Permissions

| Scope | Why it is required | Boundary |
|---|---|---|
| `filesystem:write` | Seed and update the game library under the configured 7d7d root | Default root is `$DSH_HOME/7d7d`; static serving rejects traversal |
| `network:outbound` | Optionally synchronize an explicitly configured remote community catalog | No remote catalog is contacted when `communityCatalogUrl` is empty |
| `ui:extend` | Register the 7D7D conversation view | Uses the host-provided client slot system |
| `webserver:register` | Register `/7d7d` and `/7d7d/api/server.json` on the host web server | Does not own a separate production listener |

Community game content runs in an iframe without `allow-same-origin`. Ruffle is self-hosted and no
runtime CDN fallback is allowed. The optional `fetch:ruffle` development command is not an install
script and is never executed by Workshop installation.

## Required independent evidence

Admission still requires all of the following at one new public commit:

1. exact `@deepseek-ai/dsh@0.1.0-rc.6` candidate Profile installation on
   `@deepseek-ai/dsh-web-app@0.1.0-rc.6`;
2. config composition showing the `7d7d` entry;
3. live registration and invocation of the named `/7d7d/api/manifest.json` capability;
4. injected candidate failure with current Profile unchanged;
5. disable, remove, update, and previous-generation recovery;
6. independent human trust review and a separate admission change.

Until that evidence exists, seamless installation, failure isolation, and RC.6 compatibility remain
unknown even though the package manifest declares the intended adapter contract.
