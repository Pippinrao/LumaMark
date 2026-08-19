> Language: **English** · [中文](../zh/decisions/0012-github-nsis-auto-update.md)

# ADR 0012: GitHub NSIS Auto Update

**Status:** Accepted

**Date:** 2026-08-09

**Updated:** 2026-08-13 (Windows current-user manual system-proxy boundary); 2026-08-19 (background download and confirm-to-install)

## Purpose and scope

This document records release, verification, and network-proxy boundaries for in-app auto update on Windows x64. Scope includes the official updater plugin, GitHub Release static `latest.json`, NSIS-only artifacts, minisign key management, a single current-user manual system proxy, and rollback conditions. It does not define macOS/Linux update channels, code-signing certificates, or SmartScreen trust.

## Context

LumaMark Windows distribution centers on the NSIS installer. Users need to check and install updates in-app without manually opening the GitHub Release page. The update path must be signature-verifiable, rollback-capable, and compatible with mature-components-first.

## Decision

Adopt official `tauri-plugin-updater` + `@tauri-apps/plugin-updater`:

1. The update source is the GitHub Release static file `latest.json` (`releases/latest/download/latest.json`), not a runtime-assembled GitHub API.
2. Release artifacts consider only Windows NSIS: `LumaMark_{version}_x64-setup.exe` and the matching `.sig`.
3. Use minisign signature verification; the public key is written to `src-tauri/tauri.conf.json`; private key and passphrase live in GitHub Secrets (`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
4. The app layer wraps the plugin through `src/services/updater/`; UI lives in `src/features/updates/` and business components do not depend on the plugin object directly.
5. Add tag-triggered `.github/workflows/windows-release-publish.yml`: verify tag matches version, signed-build NSIS, generate `latest.json`, and create the GitHub Release. NSIS produced by Windows CI must be signed with the same GitHub Secrets; locally unsigned installers are for local acceptance only and must not be official distribution or updater artifacts.
6. On the Windows target, Cargo feature-union enables `system-proxy` for the `reqwest 0.13.4` actually used by the official updater; do not change `updaterService.ts`, UI, IPC, or the install flow.

7. Download and install stay separate official plugin calls. "Update Now" starts `update.download()` in the background; the dialog may be dismissed while the download continues. Opening Check for Updates during download, ready-to-install, or installing reopens that state and does not start another check. When the download finishes, the dialog opens automatically so the user confirms before `update.install()`. Silent install remains rejected.

### Install confirmation UX

- Users must confirm before the installer runs; a finished download is not an install.
- Progress belongs in the existing update dialog. Do not add a second progress surface or extra explanatory copy.
- Checking for updates is a single in-flight task: overlapping checks during download or install are defects.

### Windows proxy support boundary

Windows x64 NSIS updater proxy selection follows these boundaries:

1. Protocol-specific `HTTP_PROXY` / `HTTPS_PROXY` settings take precedence over Windows Internet Settings; `NO_PROXY` still participates in bypass, and when environment bypass rules are configured, system `ProxyOverride` does not override them.
2. When the corresponding protocol is not decided by `HTTP_PROXY` / `HTTPS_PROXY`, support reading the current user’s enabled single manual proxy from Windows Internet Settings: `ProxyEnable`, a simple `ProxyServer` (single `host:port` endpoint), and an ordinary `ProxyOverride` host bypass list.
3. `ALL_PROXY` is only a fallback when no corresponding protocol proxy exists; corresponding protocol proxies here include system values filled from Windows Internet Settings, so a system manual proxy can take precedence over `ALL_PROXY`.
4. This round does not commit to PAC / `AutoConfigURL`, WPAD / auto-detect, WinHTTP proxy from `netsh winhttp`, complex per-protocol `ProxyServer` formats, full Windows `<local>` semantics, or NTLM / Kerberos enterprise integrated auth. Those capabilities require re-evaluating official dependency support; do not parse the registry or implement a proxy stack in the app layer.

To ensure the feature union applies to the same crate the official updater currently resolves, the Windows target dependency pins `reqwest` exactly to `=0.13.4`, disables default features, and explicitly requests only `system-proxy`. `pnpm quality:updater-proxy` uses locked, `x86_64-pc-windows-msvc`-filtered `cargo metadata` to verify the updater has exactly one direct `reqwest`, version still `0.13.4`, resolved features include `system-proxy`, and the corresponding `hyper-util` includes `client-proxy-system`. If an updater upgrade switches `reqwest` version or dependency path, the gate must fail closed; revisit before changing the exact pin.

## Alternatives considered

- **Custom GitHub Releases API + launch NSIS:** lacks official signature verification and install lifecycle, violates mature-components-first, and leaks platform detail into features.
- **Ship MSI only or primarily promote MSI:** product release strategy is already NSIS-only.
- **Force silent upgrades:** conflicts with predictable interaction for long writing sessions; users must confirm before install.
- **App-layer registry reading or PAC/enterprise proxy implementation:** duplicates mature HTTP-stack capability and expands credential/platform compatibility risk; currently only enable the minimal system-proxy path already provided by the official dependency.

## Consequences

- New dependencies: `tauri-plugin-updater`, `@tauri-apps/plugin-updater`.
- Capability adds `updater:default`.
- Windows x64 updater downloads may use the current user’s enabled simple manual system proxy; protocol-specific `HTTP_PROXY` / `HTTPS_PROXY` still take precedence; full priority is above.
- Windows target gains an exact `reqwest 0.13.4` feature-union dependency; its version must stay aligned with the official updater’s actual dependency and is protected by the CI metadata gate.
- Releases must provide the signing private key; losing the key prevents already-installed users from receiving signed updates.
- Portable / non-installed paths are not guaranteed updatable; failures must surface clear, localizable error copy.
- Direct GitHub connectivity in China may be unstable; later mitigation can append `endpoints` mirrors without changing business code.

## Rollback and revisit criteria

- Emergency stop-update: unmark the bad GitHub Release as latest, or remove `latest.json` from the Release; the client check fails and shows an error without forced install.
- If the official updater has unacceptable install failure rates on the Windows NSIS path, first disable auto-check and fall back to manual Release download.
- When multi-channel (beta/stable) or a non-GitHub primary source is needed, revisit endpoints and the release contract.
- When PAC/WPAD, WinHTTP, complex per-protocol proxies, full `<local>` semantics, or NTLM/Kerberos are required, revisit the network stack and credential boundary.
- When upgrading `tauri-plugin-updater` causes the metadata gate to detect a `reqwest` version or dependency-graph change, re-check the official feature graph before changing the exact pin; do not merely loosen the gate.
- Switching to a code-signing-certificate-driven update path requires a new ADR.
