use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{RwLock, RwLockReadGuard};

use crate::errors::AppError;
use crate::services::file_service::normalize_path;

#[derive(Debug, Clone)]
struct ActiveWorkspace {
    canonical_root: PathBuf,
    normalized_root: PathBuf,
}

#[derive(Debug, Default)]
pub struct WorkspaceSession {
    active: RwLock<Option<ActiveWorkspace>>,
}

#[derive(Debug)]
pub struct AuthorizedWorkspaceRoot<'a> {
    _guard: RwLockReadGuard<'a, Option<ActiveWorkspace>>,
    normalized_root: PathBuf,
}

impl AuthorizedWorkspaceRoot<'_> {
    pub fn path(&self) -> &Path {
        &self.normalized_root
    }
}

impl WorkspaceSession {
    pub fn activate(&self, root: &Path) -> Result<(), AppError> {
        let active = active_workspace_from_path(root)?;
        let mut guard = self.active.write().map_err(|_| AppError::invalid_path())?;
        *guard = Some(active);
        Ok(())
    }

    pub fn authorize_claimed_root(
        &self,
        claimed_root: &Path,
    ) -> Result<AuthorizedWorkspaceRoot<'_>, AppError> {
        let guard = self.active.read().map_err(|_| AppError::invalid_path())?;
        let active = guard.as_ref().ok_or_else(AppError::invalid_path)?;
        let current = active_workspace_from_path(&active.normalized_root)?;
        if current.canonical_root != active.canonical_root {
            return Err(AppError::invalid_path());
        }

        let claimed = active_workspace_from_path(claimed_root)?;
        if claimed.canonical_root != active.canonical_root {
            return Err(AppError::invalid_path());
        }

        let normalized_root = active.normalized_root.clone();
        Ok(AuthorizedWorkspaceRoot {
            _guard: guard,
            normalized_root,
        })
    }
}

fn active_workspace_from_path(root: &Path) -> Result<ActiveWorkspace, AppError> {
    let normalized_root = normalize_path(root).map_err(|_| AppError::invalid_path())?;
    let metadata = fs::metadata(&normalized_root).map_err(|_| AppError::invalid_path())?;
    if !metadata.is_dir() {
        return Err(AppError::invalid_path());
    }
    let canonical_root =
        fs::canonicalize(&normalized_root).map_err(|_| AppError::invalid_path())?;
    Ok(ActiveWorkspace {
        canonical_root,
        normalized_root,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::{mpsc, Arc};
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::WorkspaceSession;
    use crate::services::file_service::normalize_path;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lumamark-workspace-session-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("test directory should be created");
        dir
    }

    #[cfg(windows)]
    fn create_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return Ok(());
        }

        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other("directory link is unavailable"))
        }
    }

    #[cfg(unix)]
    fn create_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[test]
    fn authorization_rejects_claim_when_no_workspace_is_active() {
        let root = unique_test_dir("inactive");
        let session = WorkspaceSession::default();

        let error = session
            .authorize_claimed_root(&root)
            .expect_err("mutation must require an active workspace");

        assert_eq!(error.code, "file.invalid_path");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn activating_another_workspace_invalidates_the_previous_claim() {
        let first = unique_test_dir("switch-first");
        let second = unique_test_dir("switch-second");
        let session = WorkspaceSession::default();
        session.activate(&first).expect("activate first workspace");

        assert_eq!(
            session.authorize_claimed_root(&first).unwrap().path(),
            normalize_path(&first).unwrap()
        );
        session
            .activate(&second)
            .expect("activate second workspace");

        assert_eq!(
            session.authorize_claimed_root(&first).unwrap_err().code,
            "file.invalid_path"
        );
        assert_eq!(
            session.authorize_claimed_root(&second).unwrap().path(),
            normalize_path(&second).unwrap()
        );
        fs::remove_dir_all(first).expect("cleanup first");
        fs::remove_dir_all(second).expect("cleanup second");
    }

    #[test]
    fn canonical_alias_claim_returns_the_activated_normal_path() {
        let container = unique_test_dir("canonical-alias");
        let real_root = container.join("real-root");
        let linked_root = container.join("linked-root");
        fs::create_dir_all(&real_root).expect("real root");
        create_directory_link(&real_root, &linked_root).expect("directory link fixture");
        let session = WorkspaceSession::default();
        session
            .activate(&linked_root)
            .expect("activate linked root");

        let authorized = session
            .authorize_claimed_root(&real_root)
            .expect("canonical aliases should identify the same active workspace");

        assert_eq!(authorized.path(), normalize_path(&linked_root).unwrap());
        assert_ne!(authorized.path(), fs::canonicalize(&linked_root).unwrap());
        fs::remove_dir_all(container).expect("cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn windows_case_and_verbatim_prefix_claims_match_the_active_workspace() {
        let root = unique_test_dir("windows-spelling");
        let root_name = root.file_name().expect("root name").to_string_lossy();
        let alternate_name = root_name.to_ascii_uppercase();
        assert_ne!(alternate_name, root_name);
        let alternate_case = root.with_file_name(alternate_name);
        let verbatim = PathBuf::from(format!(r"\\?\{}", root.display()));
        let session = WorkspaceSession::default();
        session.activate(&root).expect("activate workspace");

        assert_eq!(
            session
                .authorize_claimed_root(&alternate_case)
                .unwrap()
                .path(),
            normalize_path(&root).unwrap()
        );
        assert_eq!(
            session.authorize_claimed_root(&verbatim).unwrap().path(),
            normalize_path(&root).unwrap()
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn authorization_rejects_an_activated_root_that_no_longer_exists() {
        let root = unique_test_dir("removed-root");
        let session = WorkspaceSession::default();
        session.activate(&root).expect("activate workspace");
        fs::remove_dir_all(&root).expect("remove active root");

        let error = session
            .authorize_claimed_root(&root)
            .expect_err("a missing active workspace cannot authorize mutation");

        assert_eq!(error.code, "file.invalid_path");
    }

    #[test]
    fn authorized_root_lease_prevents_workspace_switch_until_mutation_finishes() {
        let first = unique_test_dir("lease-first");
        let second = unique_test_dir("lease-second");
        let session = Arc::new(WorkspaceSession::default());
        session.activate(&first).expect("activate first workspace");
        let authorized = session
            .authorize_claimed_root(&first)
            .expect("authorize active workspace");
        assert_eq!(authorized.path(), normalize_path(&first).unwrap());
        let (attempting_tx, attempting_rx) = mpsc::channel();
        let (activated_tx, activated_rx) = mpsc::channel();
        let thread_session = Arc::clone(&session);
        let thread_second = second.clone();
        let switch = std::thread::spawn(move || {
            attempting_tx.send(()).expect("signal switch attempt");
            thread_session
                .activate(&thread_second)
                .expect("activate second workspace");
            activated_tx.send(()).expect("signal activation");
        });
        attempting_rx.recv().expect("switch should start");

        assert!(activated_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        drop(authorized);
        activated_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("switch should finish after mutation lease is released");
        switch.join().expect("switch thread");
        fs::remove_dir_all(first).expect("cleanup first");
        fs::remove_dir_all(second).expect("cleanup second");
    }
}
