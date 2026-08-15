use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::errors::AppError;
use crate::services::opener_service::{
    open_external_url, reveal_path_in_os, OpenExternalUrlResult, PathRevealer, RevealPathResult,
    UrlOpener,
};
use crate::services::workspace_session_service::AuthorizedWorkspaceRoot;
use crate::services::workspace_session_service::WorkspaceSession;

struct PluginUrlOpener<'a> {
    app: &'a AppHandle,
}

impl UrlOpener for PluginUrlOpener<'_> {
    fn open_url(&self, url: &str) -> Result<(), AppError> {
        self.app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|error| {
                AppError::new(
                    "link.open_failed",
                    format!("Failed to open URL: {error}"),
                    true,
                )
            })
    }
}

struct PluginPathRevealer<'a> {
    app: &'a AppHandle,
}

impl PathRevealer for PluginPathRevealer<'_> {
    fn reveal_item(&self, path: &Path) -> Result<(), AppError> {
        self.app.opener().reveal_item_in_dir(path).map_err(|error| {
            AppError::new(
                "image.reveal_failed",
                format!("Failed to reveal path: {error}"),
                true,
            )
        })
    }
}

#[tauri::command]
pub fn opener_open_url(app: AppHandle, url: String) -> Result<OpenExternalUrlResult, AppError> {
    open_external_url(&url, &PluginUrlOpener { app: &app })
}

#[tauri::command]
pub fn opener_reveal_path(
    app: AppHandle,
    path: String,
    workspace_root: Option<String>,
    document_path: Option<String>,
    workspace_session: State<'_, WorkspaceSession>,
) -> Result<RevealPathResult, AppError> {
    let workspace = authorize_reveal_workspace_root(
        &workspace_session,
        workspace_root.as_deref().map(Path::new),
    )?;
    let document = document_path.as_deref().map(PathBuf::from);

    reveal_path_in_os(
        Path::new(&path),
        workspace.as_ref().map(AuthorizedWorkspaceRoot::path),
        document.as_deref(),
        &PluginPathRevealer { app: &app },
    )
}

fn authorize_reveal_workspace_root<'a>(
    workspace_session: &'a WorkspaceSession,
    claimed_root: Option<&Path>,
) -> Result<Option<AuthorizedWorkspaceRoot<'a>>, AppError> {
    claimed_root
        .map(|root| workspace_session.authorize_claimed_root(root))
        .transpose()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::authorize_reveal_workspace_root;
    use crate::services::workspace_session_service::WorkspaceSession;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lumamark-opener-command-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("test directory should be created");
        dir
    }

    #[test]
    fn webview_capability_cannot_bypass_validated_opener_commands() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/default.json"))
                .expect("default capability should be valid JSON");
        let permissions = capability["permissions"]
            .as_array()
            .expect("default capability should list permissions");

        assert!(permissions.iter().all(|permission| {
            let identifier = permission.as_str().or_else(|| {
                permission
                    .get("identifier")
                    .and_then(serde_json::Value::as_str)
            });
            !identifier.is_some_and(|identifier| identifier.starts_with("opener:"))
        }));
    }

    #[test]
    fn reveal_workspace_claim_requires_an_active_workspace_session() {
        let root = unique_test_dir("inactive-workspace");
        let session = WorkspaceSession::default();

        let error = authorize_reveal_workspace_root(&session, Some(&root))
            .expect_err("reveal must not trust an unactivated workspace claim");

        assert_eq!(error.code, "file.invalid_path");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reveal_without_workspace_claim_preserves_document_only_authorization() {
        let session = WorkspaceSession::default();

        let authorized = authorize_reveal_workspace_root(&session, None)
            .expect("standalone documents do not require a workspace session");

        assert!(authorized.is_none());
    }
}
