use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::errors::AppError;
use crate::services::settings_service::{
    load_settings, mark_acceptance_settings_close_entered,
    save_settings_with_acceptance_write_barrier, LumaMarkSettings, SettingsLoadResult,
};

pub const ACCEPTANCE_SETTINGS_CONFIG_DIR_ENV: &str = "LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR";
pub const ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR_ENV: &str =
    "LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR";
pub const ACCEPTANCE_MODE_ENV: &str = "LUMAMARK_ACCEPTANCE_MODE";
const ACCEPTANCE_TEMP_PREFIX: &str = "lumamark-menu-context-os-";
const ACCEPTANCE_CONFIG_LEAF: &str = "settings-config";
const ACCEPTANCE_WRITE_BARRIER_LEAF: &str = "settings-write-barrier";

#[derive(Debug, PartialEq)]
struct AcceptanceSettingsPaths {
    config_dir: PathBuf,
    write_barrier_dir: Option<PathBuf>,
}

#[tauri::command]
pub async fn settings_get(app: AppHandle) -> Result<SettingsLoadResult, AppError> {
    let config_dir = resolve_config_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || load_settings(&config_dir))
        .await
        .map_err(|_| settings_task_error())?
}

#[tauri::command]
pub async fn settings_set(app: AppHandle, settings: LumaMarkSettings) -> Result<(), AppError> {
    let paths = resolve_settings_paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        save_settings_with_acceptance_write_barrier(
            &paths.config_dir,
            &settings,
            paths.write_barrier_dir.as_deref(),
        )
    })
    .await
    .map_err(|_| settings_task_error())?
}

#[tauri::command]
pub fn settings_acceptance_config_dir() -> Result<String, AppError> {
    let Some(config_dir) = acceptance_settings_config_dir_from_environment()? else {
        return Err(acceptance_config_dir_unavailable());
    };

    config_dir.to_str().map(ToOwned::to_owned).ok_or_else(|| {
        AppError::new(
            "settings.acceptance_config_dir_invalid",
            "The acceptance settings config directory must be valid UTF-8.",
            false,
        )
    })
}

#[tauri::command]
pub fn settings_acceptance_write_barrier_dir() -> Result<String, AppError> {
    let Some(paths) = acceptance_settings_paths_from_environment()? else {
        return Err(acceptance_write_barrier_dir_unavailable());
    };
    let Some(write_barrier_dir) = paths.write_barrier_dir else {
        return Err(acceptance_write_barrier_dir_unavailable());
    };

    write_barrier_dir
        .to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(invalid_acceptance_write_barrier_dir)
}

#[tauri::command]
pub async fn settings_acceptance_mark_close_entered() -> Result<bool, AppError> {
    let write_barrier_dir =
        acceptance_settings_paths_from_environment()?.and_then(|paths| paths.write_barrier_dir);
    tauri::async_runtime::spawn_blocking(move || {
        mark_acceptance_settings_close_entered(write_barrier_dir.as_deref())
    })
    .await
    .map_err(|_| settings_task_error())?
}

pub(crate) fn acceptance_settings_config_dir_from_environment() -> Result<Option<PathBuf>, AppError>
{
    Ok(acceptance_settings_paths_from_environment()?.map(|paths| paths.config_dir))
}

fn acceptance_settings_paths_from_environment() -> Result<Option<AcceptanceSettingsPaths>, AppError>
{
    resolve_acceptance_settings_paths(
        std::env::var_os(ACCEPTANCE_MODE_ENV),
        std::env::var_os(ACCEPTANCE_SETTINGS_CONFIG_DIR_ENV),
        std::env::var_os(ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR_ENV),
        &std::env::temp_dir(),
    )
}

fn settings_task_error() -> AppError {
    AppError::new(
        "settings.task_failed",
        "The settings operation could not complete.",
        true,
    )
}

fn resolve_config_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(resolve_settings_paths(app)?.config_dir)
}

fn resolve_settings_paths(app: &AppHandle) -> Result<AcceptanceSettingsPaths, AppError> {
    if let Some(paths) = acceptance_settings_paths_from_environment()? {
        return Ok(paths);
    }
    let config_dir = app.path().app_config_dir().map_err(|_| {
        AppError::new(
            "settings.config_dir_unavailable",
            "Application config directory is unavailable.",
            true,
        )
    })?;
    Ok(AcceptanceSettingsPaths {
        config_dir,
        write_barrier_dir: None,
    })
}

#[cfg(test)]
fn resolve_config_dir_from_parts(
    acceptance_mode: Option<OsString>,
    acceptance_override: Option<OsString>,
    system_temp_dir: &Path,
    default_config_dir: Result<PathBuf, AppError>,
) -> Result<PathBuf, AppError> {
    match resolve_acceptance_config_dir(acceptance_mode, acceptance_override, system_temp_dir)? {
        Some(config_dir) => Ok(config_dir),
        None => default_config_dir,
    }
}

fn resolve_acceptance_settings_paths(
    acceptance_mode: Option<OsString>,
    config_value: Option<OsString>,
    write_barrier_value: Option<OsString>,
    system_temp_dir: &Path,
) -> Result<Option<AcceptanceSettingsPaths>, AppError> {
    let config_dir =
        resolve_acceptance_config_dir(acceptance_mode.clone(), config_value, system_temp_dir)?;
    let Some(config_dir) = config_dir else {
        if write_barrier_value.is_some() {
            return Err(AppError::new(
                "settings.acceptance_mode_required",
                "The acceptance settings write barrier requires explicit acceptance mode.",
                false,
            ));
        }
        return Ok(None);
    };
    let write_barrier_dir =
        resolve_acceptance_write_barrier_dir(write_barrier_value, &config_dir, system_temp_dir)?;
    Ok(Some(AcceptanceSettingsPaths {
        config_dir,
        write_barrier_dir,
    }))
}

fn resolve_acceptance_config_dir(
    acceptance_mode: Option<OsString>,
    value: Option<OsString>,
    system_temp_dir: &Path,
) -> Result<Option<PathBuf>, AppError> {
    match acceptance_mode.as_deref() {
        None => {
            if value.is_some() {
                return Err(AppError::new(
                    "settings.acceptance_mode_required",
                    "The acceptance settings override requires explicit acceptance mode.",
                    false,
                ));
            }
            return Ok(None);
        }
        Some(mode) if mode != std::ffi::OsStr::new("1") => {
            return Err(invalid_acceptance_mode());
        }
        Some(_) => {}
    }
    let Some(value) = value else {
        return Err(acceptance_config_dir_unavailable());
    };
    resolve_scoped_acceptance_leaf(
        PathBuf::from(value),
        system_temp_dir,
        ACCEPTANCE_CONFIG_LEAF,
        invalid_acceptance_config_dir,
    )
    .map(Some)
}

fn resolve_acceptance_write_barrier_dir(
    value: Option<OsString>,
    config_dir: &Path,
    system_temp_dir: &Path,
) -> Result<Option<PathBuf>, AppError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let write_barrier_dir = resolve_scoped_acceptance_leaf(
        PathBuf::from(value),
        system_temp_dir,
        ACCEPTANCE_WRITE_BARRIER_LEAF,
        invalid_acceptance_write_barrier_dir,
    )?;
    if write_barrier_dir.parent() != config_dir.parent() {
        return Err(invalid_acceptance_write_barrier_dir());
    }
    Ok(Some(write_barrier_dir))
}

fn resolve_scoped_acceptance_leaf(
    path: PathBuf,
    system_temp_dir: &Path,
    expected_leaf: &str,
    invalid_path: fn() -> AppError,
) -> Result<PathBuf, AppError> {
    let has_unsafe_component = path
        .components()
        .any(|component| matches!(component, Component::CurDir | Component::ParentDir));
    let expected_parent = path.parent();
    let uses_scoped_temp_root = expected_parent
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(ACCEPTANCE_TEMP_PREFIX))
        && expected_parent.and_then(Path::parent) == Some(system_temp_dir)
        && path.file_name().and_then(|name| name.to_str()) == Some(expected_leaf);
    if !path.is_absolute() || has_unsafe_component || !uses_scoped_temp_root {
        return Err(invalid_path());
    }

    let canonical_temp = fs::canonicalize(system_temp_dir).map_err(|_| invalid_path())?;
    let canonical_path = fs::canonicalize(&path).map_err(|_| invalid_path())?;
    let canonical_parent = canonical_path.parent();
    let canonical_root = canonical_parent.and_then(Path::parent);
    let remains_inside_scoped_temp = canonical_path.is_dir()
        && canonical_path.file_name().and_then(|name| name.to_str()) == Some(expected_leaf)
        && canonical_parent
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(ACCEPTANCE_TEMP_PREFIX))
        && canonical_root == Some(canonical_temp.as_path());
    if !remains_inside_scoped_temp {
        return Err(invalid_path());
    }

    Ok(canonical_path)
}

fn invalid_acceptance_config_dir() -> AppError {
    AppError::new(
        "settings.acceptance_config_dir_invalid",
        "The acceptance settings config directory must be a pre-created scoped leaf of its temporary acceptance root.",
        false,
    )
}

fn invalid_acceptance_mode() -> AppError {
    AppError::new(
        "settings.acceptance_mode_invalid",
        "Acceptance mode must be exactly 1 when it is configured.",
        false,
    )
}

fn invalid_acceptance_write_barrier_dir() -> AppError {
    AppError::new(
        "settings.acceptance_write_barrier_dir_invalid",
        "The acceptance settings write barrier must be a pre-created scoped leaf beside the temporary settings config directory.",
        false,
    )
}

fn acceptance_write_barrier_dir_unavailable() -> AppError {
    AppError::new(
        "settings.acceptance_write_barrier_dir_unavailable",
        "The acceptance settings write barrier is not enabled.",
        false,
    )
}

fn acceptance_config_dir_unavailable() -> AppError {
    AppError::new(
        "settings.acceptance_config_dir_unavailable",
        "The acceptance settings config directory is not enabled.",
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_acceptance_config_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the unix epoch")
            .as_nanos();
        std::env::temp_dir()
            .join(format!(
                "lumamark-menu-context-os-{name}-{}-{nonce}",
                std::process::id()
            ))
            .join("settings-config")
    }

    #[test]
    fn acceptance_override_must_be_absolute_and_has_priority() {
        let system_temp = std::env::temp_dir();
        let absolute = unique_acceptance_config_dir("priority");
        fs::create_dir_all(&absolute).expect("acceptance leaf should be created");
        let expected = fs::canonicalize(&absolute).expect("acceptance leaf should canonicalize");
        let resolved = resolve_config_dir_from_parts(
            Some(OsString::from("1")),
            Some(absolute.clone().into_os_string()),
            &system_temp,
            Err(AppError::new("fallback.unavailable", "fallback", true)),
        )
        .expect("absolute acceptance override should be used");

        assert_eq!(resolved, expected);
        fs::remove_dir_all(absolute.parent().expect("acceptance root")).expect("cleanup");
    }

    #[test]
    fn acceptance_override_rejects_relative_or_parent_components() {
        let system_temp = std::env::temp_dir();
        let relative = resolve_config_dir_from_parts(
            Some(OsString::from("1")),
            Some(OsString::from("relative-config")),
            &system_temp,
            Ok(PathBuf::from("fallback")),
        )
        .expect_err("relative override must be rejected");
        assert_eq!(relative.code, "settings.acceptance_config_dir_invalid");

        let absolute_with_parent = std::env::temp_dir()
            .join("lumamark-parent")
            .join("..")
            .join("escape");
        let parent = resolve_config_dir_from_parts(
            Some(OsString::from("1")),
            Some(absolute_with_parent.into_os_string()),
            &system_temp,
            Ok(PathBuf::from("fallback")),
        )
        .expect_err("parent component must be rejected");
        assert_eq!(parent.code, "settings.acceptance_config_dir_invalid");
    }

    #[test]
    fn normal_config_resolution_uses_the_tauri_fallback_without_override() {
        let fallback = std::env::temp_dir().join("lumamark-normal-settings");
        let resolved =
            resolve_config_dir_from_parts(None, None, &std::env::temp_dir(), Ok(fallback.clone()))
                .expect("normal fallback should remain available");

        assert_eq!(resolved, fallback);
    }

    #[test]
    fn override_without_acceptance_mode_fails_closed() {
        let system_temp = std::env::temp_dir();
        let override_path = system_temp
            .join("lumamark-menu-context-os-unit-test")
            .join("settings-config");

        let error = resolve_config_dir_from_parts(
            None,
            Some(override_path.into_os_string()),
            &system_temp,
            Ok(PathBuf::from("must-not-fallback")),
        )
        .expect_err("an override without acceptance mode must fail closed");

        assert_eq!(error.code, "settings.acceptance_mode_required");
    }

    #[test]
    fn invalid_acceptance_mode_never_falls_back() {
        for invalid_mode in ["", "0", "true"] {
            let error = resolve_config_dir_from_parts(
                Some(OsString::from(invalid_mode)),
                None,
                &std::env::temp_dir(),
                Ok(PathBuf::from("must-not-fallback")),
            )
            .expect_err("an explicitly invalid acceptance mode must fail closed");

            assert_eq!(error.code, "settings.acceptance_mode_invalid");
        }
    }

    #[test]
    fn acceptance_mode_without_override_does_not_fall_back() {
        let error = resolve_config_dir_from_parts(
            Some(OsString::from("1")),
            None,
            &std::env::temp_dir(),
            Ok(PathBuf::from("must-not-fallback")),
        )
        .expect_err("acceptance mode without its scoped path must fail closed");

        assert_eq!(error.code, "settings.acceptance_config_dir_unavailable");
    }

    #[test]
    fn acceptance_mode_requires_a_scoped_temp_leaf() {
        let system_temp = std::env::temp_dir();
        let outside_prefix = system_temp.join("arbitrary").join("settings-config");
        let wrong_leaf = system_temp
            .join("lumamark-menu-context-os-unit-test")
            .join("other-config");

        for invalid in [outside_prefix, wrong_leaf] {
            let error = resolve_config_dir_from_parts(
                Some(OsString::from("1")),
                Some(invalid.into_os_string()),
                &system_temp,
                Ok(PathBuf::from("must-not-fallback")),
            )
            .expect_err("acceptance path must use its random temp root and fixed leaf");
            assert_eq!(error.code, "settings.acceptance_config_dir_invalid");
        }
    }

    #[test]
    fn acceptance_mode_rejects_a_scoped_path_that_was_not_created() {
        let system_temp = std::env::temp_dir();
        let missing = unique_acceptance_config_dir("missing");
        assert!(!missing.exists(), "test path must begin absent");

        let error = resolve_config_dir_from_parts(
            Some(OsString::from("1")),
            Some(missing.into_os_string()),
            &system_temp,
            Ok(PathBuf::from("must-not-fallback")),
        )
        .expect_err("the acceptance script must create its scoped directory first");

        assert_eq!(error.code, "settings.acceptance_config_dir_invalid");
    }

    #[test]
    fn acceptance_write_barrier_requires_the_fixed_leaf_beside_the_config_dir() {
        let config_dir = unique_acceptance_config_dir("write-barrier-valid");
        let acceptance_root = config_dir.parent().expect("acceptance root").to_path_buf();
        let barrier_dir = acceptance_root.join("settings-write-barrier");
        fs::create_dir_all(&config_dir).expect("config leaf should be created");
        fs::create_dir_all(&barrier_dir).expect("barrier leaf should be created");

        let resolved = resolve_acceptance_settings_paths(
            Some(OsString::from("1")),
            Some(config_dir.clone().into_os_string()),
            Some(barrier_dir.clone().into_os_string()),
            &std::env::temp_dir(),
        )
        .expect("scoped acceptance paths should resolve")
        .expect("acceptance mode should return paths");

        assert_eq!(
            resolved.config_dir,
            fs::canonicalize(&config_dir).expect("canonical config")
        );
        assert_eq!(
            resolved.write_barrier_dir,
            Some(fs::canonicalize(&barrier_dir).expect("canonical barrier"))
        );
        fs::remove_dir_all(acceptance_root).expect("cleanup");
    }

    #[test]
    fn acceptance_write_barrier_rejects_another_temp_root() {
        let config_dir = unique_acceptance_config_dir("write-barrier-config");
        let other_config_dir = unique_acceptance_config_dir("write-barrier-other");
        let barrier_dir = other_config_dir
            .parent()
            .expect("other acceptance root")
            .join("settings-write-barrier");
        fs::create_dir_all(&config_dir).expect("config leaf should be created");
        fs::create_dir_all(&barrier_dir).expect("barrier leaf should be created");

        let error = resolve_acceptance_settings_paths(
            Some(OsString::from("1")),
            Some(config_dir.clone().into_os_string()),
            Some(barrier_dir.into_os_string()),
            &std::env::temp_dir(),
        )
        .expect_err("barrier and config must share one owned temp root");

        assert_eq!(error.code, "settings.acceptance_write_barrier_dir_invalid");
        fs::remove_dir_all(config_dir.parent().expect("config root")).expect("cleanup config");
        fs::remove_dir_all(other_config_dir.parent().expect("other root")).expect("cleanup other");
    }

    #[test]
    fn acceptance_write_barrier_without_mode_fails_closed() {
        let barrier_dir = std::env::temp_dir()
            .join("lumamark-menu-context-os-write-barrier-no-mode")
            .join("settings-write-barrier");

        let error = resolve_acceptance_settings_paths(
            None,
            None,
            Some(barrier_dir.into_os_string()),
            &std::env::temp_dir(),
        )
        .expect_err("barrier environment without acceptance mode must fail closed");

        assert_eq!(error.code, "settings.acceptance_mode_required");
    }

    #[test]
    fn acceptance_write_barrier_is_absent_without_any_acceptance_environment() {
        let resolved = resolve_acceptance_settings_paths(None, None, None, &std::env::temp_dir())
            .expect("normal environment should remain available");

        assert_eq!(resolved, None);
    }

    #[test]
    fn acceptance_write_barrier_rejects_a_wrong_leaf_in_the_config_root() {
        let config_dir = unique_acceptance_config_dir("write-barrier-wrong-leaf");
        let acceptance_root = config_dir.parent().expect("acceptance root").to_path_buf();
        let wrong_barrier_dir = acceptance_root.join("other-barrier");
        fs::create_dir_all(&config_dir).expect("config leaf should be created");
        fs::create_dir_all(&wrong_barrier_dir).expect("wrong leaf should be created");

        let error = resolve_acceptance_settings_paths(
            Some(OsString::from("1")),
            Some(config_dir.into_os_string()),
            Some(wrong_barrier_dir.into_os_string()),
            &std::env::temp_dir(),
        )
        .expect_err("the write barrier must use its fixed leaf name");

        assert_eq!(error.code, "settings.acceptance_write_barrier_dir_invalid");
        fs::remove_dir_all(acceptance_root).expect("cleanup");
    }
}
