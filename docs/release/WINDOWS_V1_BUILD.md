> Language: **English** · [中文](../zh/release/WINDOWS_V1_BUILD.md)

# Windows V1 Build Record

This document records how LumaMark V1 alpha is built on Windows, the artifacts produced, and remaining release gaps.

> **Historical record:** The branch names, version numbers, file sizes, and SHA-256 values below describe the corresponding Alpha builds only and must not be treated as release artifacts of the current worktree. Parity Reliability becomes a Beta candidate only after the automation gates, Windows measurements, and real self-use exit criteria in the current execution plan are all met; a successful local `pnpm build` alone does not mean a release has shipped.

## Multi-Window and Second-Instance Real Install Acceptance

`pnpm release:installer-acceptance:nsis` really installs the current NSIS into an isolated temporary directory, then explicitly hands the installed EXE and the same NSIS path to `pnpm release:installed-window-routing`, which separately verifies first instance, second instance, and concurrent duplicate launches for default `multiWindow` and `aggregateWindow`, and finally uninstalls. Before running, confirm you are in Windows Sandbox or a clean user profile with no existing LumaMark product registration; if the script finds an existing install, registry state, or process, it fails closed and will not take over, overwrite, or terminate user assets.

```powershell
pnpm release:installer-acceptance:nsis
exit $LASTEXITCODE
```

Acceptance contract:

- Each mode creates an independent random system temp root and a pre-created fixed `settings-config` leaf. Primary, secondary, and all concurrent duplicate launches must receive identical `LUMAMARK_ACCEPTANCE_MODE=1`, `LUMAMARK_ROUTING_ACCEPTANCE_MODE=1`, and `LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR`, and must remove the menu-only `LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR` from every child-process environment. Rust keeps single-instance only when the routing marker is exactly `1` and config has passed canonical containment checks; illegal markers or missing strict config cause startup failure. This entry is not general portable config and never reads or writes real user configuration.
- Case and UNC identity cases depend on a dedicated Windows VM/acceptance account that already has the `\\localhost\<drive>$` localhost administrative share enabled and accessible. The script only reads fixtures it created under the system temp directory; it never creates, enables, or changes shares. Unavailable shares are an environment-precondition gate failure; do not relax share policy on ordinary user machines just to pass acceptance.
- `tauri-plugin-single-instance` must remain the first Tauri plugin so secondary exits before the durable state plugin and therefore cannot read, restore, or rewrite this round’s isolated state. The state plugin only manages authority and does not publish ready. Primary’s sole startup worker must restore the retained target, then route initial argv, and only publish routing readiness after all of that succeeds; the callback only enqueues the worker. If the callback completes before that startup batch, the worker must wait for readiness before accessing config, and timeouts fail bounded with logging via `desktop.open_request_state_startup_timeout`—never wait forever.
- For `multiWindow`, the first new path on a cold start reuses the Tauri-prebuilt `main` with no authority; a second distinct path creates `document-1`, so one process has exactly two HWNDs. If `main` already has a retained request, routing must not overwrite it. For `aggregateWindow`, two distinct paths reuse one `main`. A no-argument launch only focuses an existing managed window and does not create a request.
- After concurrent duplicate launches of the same second path, observation by window label and editor content must still show the corresponding document only once; acceptance records primary PID, canonical executable path, process start time, window labels, path/content, durable request state, and each secondary exit result. Exactly-once is proved by the stable final durable v2 completion fence/high-water together with precise marker→label mapping, not by millisecond-scale snapshots of transient lifecycle. CDP is only for reading WebView state and cannot replace desktop input evidence.
- Aggregate scenarios reuse the hardened Win32 bridge from `installedMenuContextOsHelpers.mjs` and execute only through canonical System32 PowerShell. Every metrics / pointer operation must re-check this primary’s PID, canonical executable path, and Windows `Process.StartTime`, confirm the thread and input desktop are both interactive `Default`, convert client coordinates with `ClientToScreen`, prove via `WindowFromPoint` that the target HWND is still owned by that process, and only then allow `SendInput` to click the real editor area; any uncertain step fails closed. Final release must run against an NSIS artifact just built and installed to an isolated path; browser E2E cannot substitute.
- The temp root carries a one-time ownership token/marker. Before cleanup, re-canonicalize system temp, the random parent directory, and the fixed config leaf; verify containment, marker contents, and that this process has exited. If any ownership or occupancy fact is uncertain, keep evidence and fail; never recursively delete other directories.

This command is only the thin real-install gate for #16 window routing: it saves version, EXE/NSIS SHA-256, command and exit-code summary, window/request JSON, and per-stage screenshots, but it cannot replace the pre-release #13/#16 joint matrix. The joint matrix must still cover dirty, save/discard/cancel, undo, watcher, recent files, window-close protection, and second-instance exactly-once on the same isolated install; passing the thin gate alone is not a release conclusion.

## Menu and Context-Menu Real Pointer Acceptance

`pnpm release:installed-menu-context-os` verifies title-bar menus, portals, window buttons and dragging, editor context menus, and file-tree context menus on the Release WebView path built from the current worktree. Before running, explicitly point at the fixed artifact from the current worktree; the script checks package, Cargo, Cargo lock, Tauri config, and PE FileVersion/ProductVersion, and records the executable SHA-256 in evidence:

```powershell
$env:LUMAMARK_EXECUTABLE = (Resolve-Path 'src-tauri\target\release\lumamark.exe').Path
$acceptanceExitCode = 0
try {
  pnpm release:installed-menu-context-os
  $acceptanceExitCode = $LASTEXITCODE
} finally {
  Remove-Item Env:LUMAMARK_EXECUTABLE -ErrorAction SilentlyContinue
}
exit $acceptanceExitCode
```

Safety boundaries:

- The script creates its own random system temp root and enables release-acceptance-only settings-directory override via `LUMAMARK_ACCEPTANCE_MODE=1` + `LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR`; only that mode may also enable the settings write barrier via `LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR`. Rust accepts only fixed `settings-config` / `settings-write-barrier` leaves that were pre-created under the temp root and remain inside the same random root after canonicalization; the script then reads final paths back through two IPC calls. Illegal path or mode environment causes both startup and writes to fail closed; these entries are not a portable-config feature.
- Processes that enter acceptance mode through the strict checks above do not register the single-instance plugin, so the acceptance process and a user’s normal LumaMark launch do not forward file arguments to each other; the script still exits and cleans up only via the child-process handle it `spawn`ed and the verified identity.
- The settings-persistence scenario first uses Win32 pointer to change “Check for updates on startup” and close the settings dialog, confirming the isolated directory already has a v3 light baseline; the script then creates a one-time `arm` marker and switches to “Follow system” from the top Theme menu. Before truly saving, Rust create-new’s `entered`, keeps disk still light, and waits for a bounded `release`; after seeing `entered`, the script closes with the real window X. The close coordinator starts settings flush first, then in parallel calls the acceptance-only command; Rust accepts that command and creates `close-entered` only when `arm` and `entered` are both ordinary files and `release` has not yet appeared, and the write barrier also rejects any release without `close-entered`. After X, the script must see `close-entered`, prove via main HWND/client metrics under the same process identity that the window still exists, reconfirm the file is still light, and only then create `release`. Only after save completes and the close coordinator waits for settings flush may the window exit normally. This evidence is attributed by the marker protocol and does not depend on 400 ms debounce, a single process-liveness snapshot, or a “click fast enough” timing race. The script then restarts with the same explicit exe, the same isolated config, and a different brand-new WebView2 profile that is still under the temp root, and checks that both the settings UI and `settings.json` restore `system`. Each profile leaf must not exist before launch; after attach it must be actually created by WebView2 and contain the `EBWebView` runtime directory; the two launches do not share a browser profile, so localStorage fallback cannot satisfy this evidence.
- WebView2 user data, workspace, and Markdown fixtures for every launch live under the same random temp root. File-tree initialization uses the existing E2E workspace bridge to forward real Tauri workspace commands; all acceptance interactions are still completed by Win32 pointer.
- This acceptance, which exercises Copy/Cut/Paste, may run only on a dedicated interactive account or VM; Windows clipboard history must be off, and cloud clipboard and third-party clipboard managers must be disabled. The default gate requires an initially empty clipboard, so ordinary runs neither read nor restore existing text. Only in that dedicated environment, and only when the initial content is pre-seeded non-sensitive plain text, may you explicitly set `LUMAMARK_ACCEPTANCE_ALLOW_PLAINTEXT_CLIPBOARD_RESTORE=1`; original text is not written into arguments, logs, hashes, or evidence, and does not enter the command line—it is carried in memory over a UTF-16LE→base64 ASCII stdin/stdout channel. The script claims ownership of a write for the current command only when the sequence changes, the format is plain text, and the content matches the expected output of the command just executed character for character. The WebView writer must also be proved by `GetClipboardOwner` to have an owner inside this LumaMark/WebView2 child-process tree; official Tauri clipboard-manager on Windows writes text through `arboard` with an empty HWND, so the ownerless path is allowed only under the explicit `tauri-native-text` writer contract with `ownerHWnd=0`, `ownerProcessId=0`, `ownerBelongsToTarget=false`, and a format strictly in the recoverable plain-text set; the two writer contracts are mutually exclusive. Interrupt cleanup freezes the expected output of the current command; it then synchronously stops new input, disconnects and verifies CDP is closed, verifies and ends this child process by executable path and start time, and only then parses a pending write when all three stillness facts hold. Before reading, the script re-verifies the same metadata; after reading it exact-matches again; only then may Clipboard Sequence Number compare-and-set restore. External owner, extra formats, wrong content, sequence change, or inability to prove the writer is still all refuse overwrite. Even when restore succeeds, the system or third parties may still observe copy notifications for the non-sensitive acceptance fixture, so this script cannot claim “zero pollution” of clipboard history/cloud sync.
- The pointer bridge runs Per-Monitor V2, positively confirms via `OpenInputDesktop`/`GetUserObjectInformation` that current and thread desktops are both interactive `Default`, then validates actual cursor coordinates and hit window with `ClientToScreen`, `GetDpiForWindow`, `GetCursorPos`, and `WindowFromPoint`; every metrics/pointer action rechecks PID inside the bridge against this launch’s executable path and start time. The bridge does not call `AttachThreadInput`, `SetForegroundWindow`, `SetWindowPos`, or temporary topmost to change real desktop conditions: the window must already be visible, non-minimized, and truly hit at the requested point; then only `SendInput` lets Windows take the natural `WM_MOUSEACTIVATE` activation path, and post-click it rechecks the same responsiveness probe recorded into metrics and the foreground process. The response probe only emits the safe enum `responsive` / `timed-out` / `invalid-window` / `probe-failed`; PowerShell process timeouts are also classified only by fixed preflight/inject/postflight stages and do not record window titles, paths, or system error text. Bridge and process preflight call only absolute PowerShell/tasklist paths under canonical System32 and record their SHA-256 in evidence. On `SIGINT`/`SIGTERM`, the script stops further pointer injection and enters the same sequence-CAS, child-process, and temp-directory cleanup; exception paths after pointer down also send up in `finally`. No interrupt may produce success evidence. Before cleanup, recheck the PID’s executable path and start time, terminate only this child process, and verify the temp directory has been deleted.
- The package script has the parent runner generate a non-reusable run id first, then start the verifier. `result.json` is accepted only when run id, start/end times, and helper/verifier source SHA-256 all belong to the current child process; the parent directly records the exit code or signal observed by `spawnSync` and requires it to match the verifier’s `plannedExitCode`. Missing, stale, source drift, signal, planned mismatch, or verifier `summary.passed=false` all make the parent runner exit non-zero; final `summary.passed` must also be true together with `runnerOutcome.runnerPassed`. Raw `result.json`, `runner-outcome.json`, and logs are local diagnostic material and are not committed to the repository; evidence does not store error stacks, clipboard contents, content hashes, or unknown clipboard format names.

### 0.2.36 Live Machine Record (2026-08-15)

This round completed a full Windows live acceptance on branch `codex/settings-and-context-menu` using the current worktree’s 0.2.36 Release executable, from 2026-08-15 03:44:13Z–03:45:41Z. The tested `src-tauri/target/release/lumamark.exe` was 18,462,720 bytes, PE FileVersion / ProductVersion both `0.2.36`, SHA-256 `26abf2a9285c47ea19f89826297653b7edee6572539b3d1f6d7c2794fa3783d4`.

- Parent runner actually observed exit code `0`, signal `null`, matching verifier planned exit code `0`; run id, time window, and source identity were all fresh for this round. Runner / verifier / helper SHA-256 were `cc885213b34038b7b1aeb6a5ab55c7ba7ff9b002ac21bd139c8f7c7cfe06df72`, `aae8b9011f0d7b2bc505af8ae5e5098b9b87092d3aa92bba6910510165c1a589`, and `0131700cffff3f4e4093c807c4c7427e2bcc72925840ce6a5c100fe0d06520b8` respectively.
- `summary.passed=true`: all 143 checks passed, including 45 Win32 `SendInput` pointer events and 16 menu layouts; page error, console error, and page crash were all 0.
- Settings evidence covered v2 `light` baseline, top Theme menu switch to `system`, window X entering the close coordinator while still waiting on the write barrier, normal exit after save completed, and restart with the same isolated config plus a brand-new profile actually created by WebView2; both disk and settings UI restored to `system`.
- Editor and file-tree evidence covered title-bar portals, links, images, ordinary editing, table copy/delete, and file/directory/root context menus; image secondary click no longer activates source, and table delete removes only the exact target range and reduces widgets from 2 to 1.
- All 8 text clipboard changes were attributed by mutually exclusive writer contracts, sequence, format, and expected content together; final restore used sequence compare-and-set. CDP disconnect verified, this child process ended by identity, temp directory deleted, and all cleanup stages passed.
- This round keeps 13 PNGs with no raw clipboard content as evidence; key views include [settings first launch](../../artifacts/installed-menu-context-os/2026-08-15T03-44-12-995Z/settings-persistence-first-launch.png), [fresh-profile restart restored](../../artifacts/installed-menu-context-os/2026-08-15T03-44-12-995Z/settings-persistence-restart-restored.png), [image context menu](../../artifacts/installed-menu-context-os/2026-08-15T03-44-12-995Z/editor-image-context.png), [exact table delete](../../artifacts/installed-menu-context-os/2026-08-15T03-44-12-995Z/editor-after-table-delete.png), and [file-tree root menu](../../artifacts/installed-menu-context-os/2026-08-15T03-44-12-995Z/file-tree-root-context.png). Raw `result.json`, runner outcome, and process logs remain only in local ignored directories; this round’s result SHA-256 is `462a63fa1c43f96c24d80db45ee76d6d5c56404934e6aaffc05d7a3b5e84fba9`.

Build note: `pnpm build` of the same source successfully produced the Release EXE, MSI, and NSIS packages above, but exited with code `1` at the final updater signing stage because this machine had only the public key and no `TAURI_SIGNING_PRIVATE_KEY`. That gap does not affect this round’s live behavior evidence for the unsigned EXE, but it remains a release gate that CI / an offline signing environment must close before formal distribution.

The native folder-picker dialog may write system recent locations/MRU and cannot prove zero pollution on an ordinary development account, so it is outside this automation script. That scenario is accepted separately on a dedicated account or VM and must not be replaced by file-tree bridge results as a native-dialog conclusion.

## Auto-Update Publish (NSIS + GitHub Release)

Formal distribution accepts only GitHub Actions signed publish. Local `pnpm build:nsis` failing without `TAURI_SIGNING_PRIVATE_KEY` is expected; unsigned installers may be used only for local install acceptance and must not be uploaded to GitHub Release or used as updater artifacts.

Current formal publish path:

1. Confirm `package.json` / `Cargo.toml` / `tauri.conf.json` versions match.
2. Confirm GitHub Secrets are configured:
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (may be empty when there is no passphrase)
3. Tag and push a commit already merged to `main`, for example `git tag v0.2.53 && git push origin v0.2.53`. Do not upload NSIS from the local machine.
4. `.github/workflows/windows-release-publish.yml` will:
   - Verify the tag matches the `package.json` version
   - Inject the signing key and run `pnpm build:nsis`
   - Generate `latest.json`
   - Create a GitHub Release and upload:
     - `LumaMark_{version}_x64-setup.exe`
     - `LumaMark_{version}_x64-setup.exe.sig`
     - `latest.json`

In-app updater endpoint:

```text
https://github.com/Pippinrao/LumaMark/releases/latest/download/latest.json
```

`latest.json` contract (static manifest):

```json
{
  "version": "0.2.17",
  "notes": "",
  "pub_date": "2026-08-09T00:00:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of .sig>",
      "url": "https://github.com/Pippinrao/LumaMark/releases/download/v0.2.17/LumaMark_0.2.17_x64-setup.exe"
    }
  }
}
```

Generate the manifest locally:

```powershell
pnpm release:generate-updater-manifest
```

Key management:

- The public key is written to `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
- The private key lives only in GitHub Secrets / an offline vault; if lost, already-installed users cannot continue receiving signed updates.
- When pasting the private key into GitHub Secrets, avoid a UTF-8 BOM; the publish workflow strips BOM, but the key itself must still be valid output from `tauri signer generate`.
- Private key files must not be committed; `.gitignore` already ignores `*.key` / `*.key.pub`.

Rollback:

- Delete or unmark the bad GitHub Release so `latest` falls back to the previous version.
- To urgently disable auto-update, temporarily remove `latest.json` from the Release; installed clients will fail the check and show an error rather than force-install.

Manual full-build verification still uses `.github/workflows/windows-release-build.yml`: it likewise injects GitHub Secrets for signing and uploads exe/MSI/NSIS/`*.sig` artifacts, but does not create a Release. Formal distribution accepts only GitHub Actions signed publish.

## 0.2.3 NSIS-only Release Candidate

- Date: 2026-08-05
- Platform: Windows x64
- Branch: `main`
- Target release tag: `v0.2.3`
- Publish strategy: after the candidate passes all gates, GitHub Release uploads only the NSIS installer; bare exe, MSI, and local artifact manifests are used for consistency gates.

Candidate artifacts:

| Artifact | Path | Size | SHA-256 |
|---|---|---:|---|
| Windows executable | `src-tauri/target/release/lumamark.exe` | 13,857,792 bytes | `2e7bc99ccddf3eabfd6b443dcc362b5fe99c51fe452a036eb84514ba29cebc42` |
| MSI installer | `src-tauri/target/release/bundle/msi/LumaMark_0.2.3_x64_en-US.msi` | 6,041,600 bytes | `26f8d2cbe9208dbf8bce402148ec237023bb97292e9749f63ed2374979b353da` |
| NSIS installer | `src-tauri/target/release/bundle/nsis/LumaMark_0.2.3_x64-setup.exe` | 4,650,095 bytes | `5ac67fa71530271520480158af94b3bf45ba15cb24f9b3b7686db6da4f3a6c87` |

This version completed and accepted GitHub Issues #1–#6: media fullscreen view and zoom, full menus with precise shortcuts, reading width and platform primary-modifier zoom, startup page and single-file restore experience, active Markdown source mark visuals, and stable caret mapping in formatting, soft wrap, and non-monospace tables. Acceptance patches also covered in-place relabeling of existing media, search panel, and task checkboxes on language switch, visible feedback for startup-preference persistence errors, and real E2E interaction after the startup page.

Fresh automation verification:

- `pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com/`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`: 81 test files, 745 tests passed.
- `pnpm test:fixtures`: 2 test files, 6 round-trip tests passed.
- `pnpm download:markdown-corpus` and `pnpm test:markdown-corpus`: parsed 6 corpus files, 646,256 bytes.
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`: 81 Rust tests passed; public-network Rust tests run under a dedicated gate.
- `pnpm quality:v1-ux-prototype`: 2 passed.
- `NODE_OPTIONS=--throw-deprecation pnpm quality:v1-ux-screenshots`: produced 6 screenshots with no deprecation warnings.
- `pnpm test:e2e -- --workers=1`: 156 Playwright tests passed.
- `pnpm test:live-assets:public`: public PNG and SVG content, MIME, and signature checks passed; the first combined command hit one external Wikimedia TLS `ECONNRESET`, and the atomic command rerun passed.
- `pnpm test:live-assets:rust`: 1 real download-and-cache test passed.
- `pnpm quality:web-build`
- `pnpm test:e2e:production`: 2 production bundle tests passed.
- `pnpm perf:bench`: 6 test files, 23 independent performance benchmarks passed; 10MB document load 77.49 ms, input p80 1.07 ms.
- `pnpm release:packaged-webview`: 0.2.3 Release build and real packaged WebView verification passed.
- `pnpm release:verify-artifacts`: local 0.2.3 exe, MSI, and NSIS all present; sizes and SHA-256 match the table above.
- `pnpm release:installer-smoke:plan`: confirmed the NSIS installer exists, targets an isolated temp directory, and needs no admin rights.

Packaged WebView verification covered app startup, Mermaid active-edit save, editor input, display-mode round-trip, page-width persistence, session zoom reset, task-checkbox accessibility, and Unicode input; appearance layout restore took 19.1 ms.

This machine already has an install at `C:\Users\pippin\AppData\Local\LumaMark`; the safety script refused by design to run NSIS silent install/uninstall smoke that could affect existing install registration; this round did not bypass that protection. MSI admin install smoke was likewise not executed.

This version is still not code-signed; Windows SmartScreen and publisher-trust prompts remain known distribution risks.

## 0.2.1 NSIS-only Release

- Date: 2026-08-03
- Platform: Windows x64
- Branch: `v1-implementation`
- Release commit: `20accc2d9e0a97ab410126efc817c07dbb9ec816`
- Windows runner: [Windows Release Build 30757679582](https://github.com/Pippinrao/LumaMark/actions/runs/30757679582) (`success`)
- Release scope: GitHub Release uploads only the NSIS installer produced by the runner above; exe, MSI, and manifest are retained as workflow artifacts.

Final release artifacts:

| Artifact | Path | Size | SHA-256 |
|---|---|---:|---|
| NSIS installer | `LumaMark_0.2.1_x64-setup.exe` | 4,656,736 bytes | `6a003c9e3c798e991a820a345c0a5d5cecab6992a75e5498aebdeae6c4337efb` |

This version restructured application menus into Typora-like File, Edit, Paragraph, Format, View, Theme, Language, and Help groups, completed executable commands, disabled states, nested menus, keyboard navigation, menu shortcuts, the About dialog, and Chinese/English copy, and updated competitive analysis plus visual verification screenshots.

Fresh automation verification:

- `pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com/`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`: 68 test files, 637 tests passed.
- `pnpm test:fixtures`: 2 test files, 6 round-trip tests passed.
- `pnpm download:markdown-corpus` and `pnpm test:markdown-corpus`: parsed 6 corpus files, 646,256 bytes.
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`: 81 Rust tests passed; 1 explicitly ignored public-network test ran separately via `pnpm test:live-assets` and passed.
- `pnpm quality:v1-ux-prototype`: 2 passed.
- `pnpm quality:v1-ux-screenshots`: produced 6 review screenshots with no warnings under `NODE_OPTIONS=--throw-deprecation`.
- `pnpm test:e2e -- --workers=1`: 137 Playwright tests passed.
- `pnpm test:live-assets`: public PNG/SVG and Rust real download-cache tests passed.
- `pnpm quality:web-build`
- `pnpm test:e2e:production`: 2 production bundle tests passed, covering menu keyboard operations and lazy-loaded Mermaid.
- `pnpm perf:bench`: 6 test files, 23 independent performance benchmarks passed.
- `pnpm release:packaged-webview`: Release build and real packaged WebView verification passed, producing exe, MSI, and NSIS.
- `pnpm release:verify-artifacts`: local 0.2.1 exe, MSI, and NSIS all present with SHA-256 generated; GitHub runner manifest matched the final NSIS hash after download.
- `pnpm release:installer-smoke:plan`: confirmed the NSIS installer exists, targets an isolated temp directory, and needs no admin rights.

The local Release candidate also passed real packaged WebView startup and file-save verification. This machine already has an install at `C:\Users\pippin\AppData\Local\LumaMark`; the safety script refused by design to run silent install/uninstall smoke that could affect existing install registration, so that item was not executed; MSI admin install smoke was likewise not executed.

This version is still not code-signed; Windows SmartScreen and publisher-trust prompts remain known distribution risks.

## 0.2.0 NSIS-only Release

- Date: 2026-08-01
- Platform: Windows x64
- Branch: `v1-implementation`
- Release scope: GitHub Release uploads only the NSIS installer; local builds also produce exe and MSI solely for existing artifact consistency gates.

Final release artifacts:

| Artifact | Path | Size | SHA-256 |
|---|---|---:|---|
| NSIS installer | `src-tauri/target/release/bundle/nsis/LumaMark_0.2.0_x64-setup.exe` | 4,654,352 bytes | `cf990ae5c7f9b35ccaae8f8dba2d455079a6e54f408df2fee69115ec515ca1ae` |

Fresh automation verification:

- `pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com/`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`: 65 test files, 605 tests passed.
- `pnpm test:fixtures`: 2 test files, 6 round-trip tests passed.
- `pnpm download:markdown-corpus` and `pnpm test:markdown-corpus`: parsed 6 corpus files, 646,256 bytes.
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`: 81 Rust tests passed.
- `pnpm quality:v1-ux-prototype`: 2 passed.
- `pnpm quality:v1-ux-screenshots`: produced 6 review screenshots with no warnings under `NODE_OPTIONS=--throw-deprecation`.
- `pnpm test:e2e`: 131 Playwright tests passed.
- `pnpm test:live-assets`: public PNG/SVG and Rust real download-cache tests passed.
- `pnpm quality:web-build`
- `pnpm test:e2e:production`: production bundle startup and lazy-loaded Mermaid regression passed.
- `pnpm perf:bench`: 6 test files, 23 independent performance benchmarks passed.
- `pnpm release:packaged-webview`: Release build, real file save, Chinese input, task-checkbox accessibility, Mermaid active-save, and display-mode round-trip all passed.
- `pnpm release:verify-artifacts`: 0.2.0 exe, MSI, and NSIS all present with SHA-256 manifest generated.
- `pnpm release:installer-smoke:plan`: confirmed NSIS path, temp install directory, no admin required, and 3-second startup plan.

Windows desktop human-style spot checks used this round’s newly compiled Release exe with an isolated temporary WebView2 data directory; they verified Chinese/English Markdown input, task checkboxes inside quotes and ordinary ones, click and Space toggle, source/WYSIWYG round-trip, Mermaid render, system Save As dialog, and real file write. The saved 13-line Markdown passed assertions for headings, quoted tasks, ordinary tasks, completed tasks, Mermaid, and Chinese text; the test file and temporary WebView2 data were cleaned afterward, and existing formal install windows were not modified.

The NSIS package was identified by 7-Zip 24.08 as NSIS 3 Unicode/LZMA and passed integrity testing; the extracted `lumamark.exe` was 13,838,336 bytes, FileVersion and ProductVersion both `0.2.0`, and could start a WebView2 debug endpoint with no stderr. Because this machine already has and is running a formal install at `C:\Users\pippin\AppData\Local\LumaMark`, the safety script refused to overwrite the same HKCU install/uninstall registry; this round did not run host silent install→uninstall smoke, and package extraction plus payload launch is not treated as that path having passed.

This version is still not code-signed; Windows SmartScreen and publisher-trust prompts remain known distribution risks.

## Build Environment

- Date: 2026-07-05
- Platform: Windows
- Branch: `v1-task9-v1-convergence`
- Build entry: `pnpm build`
- Actual execution: `tauri build`, with `pnpm build:web` run before the build

## 0.1.2 NSIS-only Release

This release generates and uploads only the NSIS installer; it does not publish MSI or bare exe assets.

Build command:

```powershell
pnpm exec tauri build --bundles nsis
```

Release artifacts:

| Artifact | Path | Size | SHA-256 |
|---|---|---:|---|
| NSIS installer | `src-tauri/target/release/bundle/nsis/LumaMark_0.1.2_x64-setup.exe` | 3,275,232 bytes | `3bdabee7e1c66f5af1c47a2f01437e8f5fc7989e0d1a6491f6828e55ccf1d9f3` |

Pre-release verification for this publish:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:fixtures`
- `pnpm perf:bench`
- `pnpm test:e2e`
- `pnpm quality:web-build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm release:packaged-webview`
- `pnpm release:installer-smoke:plan`
- `pnpm release:installer-smoke:nsis`

NSIS installer smoke result: silent install to a temp directory, launch the installed `lumamark.exe` and keep it alive for 3 seconds, then silent uninstall—all passed.

## Artifacts

`pnpm build` successfully produced the Windows release executable and installers:

| Artifact | Path | Size |
|---|---|---:|
| Windows executable | `src-tauri/target/release/lumamark.exe` | 10,396,672 bytes |
| MSI installer | `src-tauri/target/release/bundle/msi/LumaMark_0.1.0_x64_en-US.msi` | 4,161,536 bytes |
| NSIS installer | `src-tauri/target/release/bundle/nsis/LumaMark_0.1.0_x64-setup.exe` | 3,152,794 bytes |

## GitHub Manual Build

A manually triggered GitHub Actions workflow has been added:

```powershell
gh workflow run "Windows Release Build" --repo Pippinrao/LumaMark --ref v1-implementation
```

Workflow file: `.github/workflows/windows-release-build.yml`.

That workflow runs `pnpm build` on a `windows-latest` runner and uploads the following build artifacts:

- `src-tauri/target/release/lumamark.exe`
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*setup.exe`
- `src-tauri/target/release/lumamark-windows-artifacts.json`

`lumamark-windows-artifacts.json` is produced by:

```powershell
pnpm release:verify-artifacts
```

That command checks that the Windows release executable, MSI installer, and NSIS installer exist and are non-empty, and records each artifact’s size and SHA-256.

GitHub manual build verification already executed:

| Item | Result |
|---|---|
| Workflow run | <https://github.com/Pippinrao/LumaMark/actions/runs/28725030218> |
| Trigger branch | `v1-implementation` |
| Commit | `8dff55e8059327a8dcf72bbe56b53b644eb4df27` |
| Status | `success` |

GitHub artifact records follow; sizes are GitHub artifact zip sizes. That run executed before the artifact manifest was wired in, so it contains only the three binary artifacts:

| Artifact | Size |
|---|---:|
| `lumamark-windows-release-exe` | 3,929,225 bytes |
| `lumamark-windows-msi` | 3,882,214 bytes |
| `lumamark-windows-nsis` | 3,065,781 bytes |

This workflow only proves that Windows release executables and installers can be built on a GitHub runner and retained as artifacts; it does not run install, uninstall, or post-install startup smoke.

## Startup Smoke

Release executable startup smoke has been executed:

```powershell
$exe = Resolve-Path 'src-tauri\target\release\lumamark.exe'
$process = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
$process.Refresh()
$started = -not $process.HasExited
if ($started) { Stop-Process -Id $process.Id -Force }
```

Result: `release exe started and stayed alive for 3 seconds`.

This smoke proves the release exe can start and stay running; it is not equivalent to post-MSI/NSIS-install startup verification.

## Installer Smoke

A repeatable Windows installer smoke script has been added:

```powershell
pnpm release:installer-smoke:plan
pnpm release:installer-smoke:nsis
```

Script location: `scripts/release/windows-installer-smoke.ps1`.

Default policy:

- `release:installer-smoke:plan` only prints a JSON plan; it does not install, uninstall, or launch the app.
- `release:installer-smoke:nsis` runs NSIS user-level silent install smoke.
- NSIS smoke installs under `lumamark-installer-smoke\nsis` in the system temp directory, launches the installed `lumamark.exe` and keeps it alive for 3 seconds, then silently uninstalls.
- The script rejects install paths outside the temporary smoke directory to avoid cleaning or overwriting non-test installs.
- The script detects existing LumaMark installs; if the install path is outside the smoke temp directory, it refuses to run real installer smoke.
- MSI smoke can be selected only via explicit `-InstallerKind Msi`; because the current MSI is `perMachine`, real execution requires an elevated PowerShell.

This round automated the installer smoke entry points and covered plan and path-safety checks with tests; real NSIS install/uninstall smoke requires explicit project-owner authorization before execution.

## Fixes in This Round

- `src-tauri/tauri.conf.json` explicitly configures `bundle.icon` using existing resources such as `src-tauri/icons/icon.ico`, fixing the Windows bundling-stage `Couldn't find a .ico icon` error.
- `identifier` changed from `com.lumamark.app` to `com.lumamark.desktop` to avoid Tauri’s cross-platform warning about the `.app` suffix.

## Known Release Gaps

- Artifacts are not yet signed. V1 alpha can be installed and tested locally, but public distribution still needs code signing, certificate management, and release verification.
- NSIS install, uninstall, and post-install startup smoke already have automated script entry points, but this round has not yet executed real installer smoke.
- MSI install, uninstall, and post-install startup smoke require admin rights; this round only provides an explicit optional entry and did not run real MSI smoke.
- The GitHub manual build workflow has proved in run `28725030218` that it can produce and upload release exe, MSI, and NSIS artifacts; real installer smoke still requires authorization before execution.
- Once `identifier` enters public distribution it should stay stable; later changes affect install identity, upgrade identity, and application data paths.
- The Web build now has a `pnpm quality:web-build` chunk gate; first-screen entry and dynamic chunk budgets both pass; heavy Mermaid/KaTeX/Cytoscape dependencies have been split out of the first-screen entry.
- This round only verified the Windows build. macOS and Linux remain architecturally compatible and are not V1 alpha release gates.

## V1 Definition-of-Done Checklist

| Check | Current evidence | Status |
|---|---|---|
| P0 capabilities | Open, edit, save, basic WYSIWYG, Mermaid, i18n, performance, and fixtures all have automation coverage | Pass |
| P1 core experience | Workspace file tree, outline, command palette, settings page, status bar, and Windows build all landed | Pass |
| App can start | `pnpm test:e2e` covers the Web shell; release exe smoke proves `lumamark.exe` can start and stay alive for 3 seconds | Pass |
| Windows install artifacts produced | `pnpm build` produces MSI and NSIS installers; GitHub run `28725030218` uploads exe, MSI, and NSIS artifacts on `windows-latest` | Pass |
| Windows post-install startup | `scripts/release/windows-installer-smoke.ps1` provides NSIS automatic smoke and optional MSI smoke; real installer smoke awaits authorized execution | Not yet covered |
| Chinese and English switchable | `tests/e2e/v1-workflow.spec.ts` covers switching to English on the settings page | Pass |
| Light and dark switchable | `tests/e2e/v1-workflow.spec.ts` asserts `html[data-theme="dark"]` | Pass |
| CodeMirror 6 is the sole primary editor core | `src/editor/core/*` is the sole editor initialization entry; no other editor core was introduced | Pass |
| React store does not hold full Markdown | `src/features/file-actions/fileActions.test.ts` asserts state after open does not contain source | Pass |
| Open `.md` files | Rust file service, file-action unit tests, and V1 workflow E2E cover the open path | Pass |
| Save current file | File-action unit tests, fixture round-trip, and V1 workflow E2E cover the save path | Pass |
| Save As | `src/features/file-actions/fileActions.test.ts` covers dialog path and save state; `tests/e2e/v1-workflow.spec.ts` covers UI Save As switching the current file to the new path, with subsequent ordinary saves continuing to write the new file | Pass |
| Save with no unrelated diff | `pnpm test:fixtures` | Pass |
| Dirty state accurate | `src/features/file-actions/fileActions.test.ts` covers success, failure, and edits during save | Pass |
| Basic WYSIWYG | `tests/e2e/editor-markdown.spec.ts` and decoration unit tests cover headings, emphasis, lists, tasks, code, and more | Pass |
| Task-list checkbox can mutate source | `tests/e2e/editor-markdown.spec.ts` covers click and undo | Pass |
| Mermaid fenced block can render asynchronously | `tests/e2e/mermaid.spec.ts` and scheduler unit tests | Pass |
| Mermaid errors do not affect editing | Mermaid scheduler/widget unit tests cover error-recovery paths; E2E covers successful render | Pass |
| File tree usable | `src/features/file-tree/FileTree.test.tsx` covers lazy-load dedupe; Task 8 E2E covers shell entry | Pass |
| Outline usable | `src/features/outline/outlineParser.test.ts` and `useDebouncedOutline.test.tsx` | Pass |
| Command palette usable | `tests/e2e/app-shell.spec.ts` covers opening the command palette and triggering a save command | Pass |
| Basic settings page usable | `tests/e2e/v1-workflow.spec.ts` covers language and theme switching | Pass |
| 1MB and 5MB files edit smoothly | `pnpm perf:bench` automation gates cover read, file-action open, editor load, and tail input | Pass |
| 10MB files do not freeze | `tests/perf/editorLargeDocument.bench.test.ts`, `openFileActionLargeDocument.bench.test.ts`, and `outlinePanelLargeDocument.bench.test.tsx` cover open, post-debounce outline refresh, virtualized outline render, and tail input | Pass |
| Web build chunk budgets | `pnpm quality:web-build` covers Vite warning-free build, first-screen entry JS under 120 KiB, and any JS chunk under 700 KiB | Pass |
| E2E covers V1 critical paths | `tests/e2e/v1-workflow.spec.ts` covers open, edit, save, Save As, reopen after reload, Mermaid, language, and theme | Pass |
| Fixture round-trip with no unrelated diff | `pnpm test:fixtures` | Pass |
| Chinese and English core copy coverage | `src/shared/i18n/i18n.test.ts` covers core keys; E2E covers language switch | Pass |
| Known data-corruption risks | Rust atomic write tests, fixture round-trip, and file-action dirty tests cover basic save risks | No blocking risk found |
