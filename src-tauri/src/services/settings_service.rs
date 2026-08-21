use std::cmp::Ordering;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};

use crate::errors::AppError;
use crate::services::file_service::write_bytes_atomically;

pub const SETTINGS_FILE_NAME: &str = "settings.json";
pub const SETTINGS_VERSION: u32 = 4;
const PAGE_WIDTHS: &[&str] = &["adaptive", "narrow", "standard", "wide", "fluid"];
const ACCEPTANCE_WRITE_BARRIER_TIMEOUT: Duration = Duration::from_secs(60);
const ACCEPTANCE_WRITE_BARRIER_POLL_INTERVAL: Duration = Duration::from_millis(10);
const ACCEPTANCE_WRITE_BARRIER_ARM: &str = "arm";
const ACCEPTANCE_WRITE_BARRIER_CLOSE_ENTERED: &str = "close-entered";
const ACCEPTANCE_WRITE_BARRIER_ENTERED: &str = "entered";
const ACCEPTANCE_WRITE_BARRIER_RELEASE: &str = "release";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LumaMarkSettings {
    pub appearance: AppearanceSettings,
    pub editor: EditorSettings,
    pub general: GeneralSettings,
    pub images: ImageSettings,
    #[serde(default = "default_markdown_settings")]
    pub markdown: MarkdownSettings,
    pub updates: UpdateSettings,
    pub version: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub font_zoom_percent: u32,
    pub page_width: String,
    pub sidebar_open_on_startup: bool,
    pub theme: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    pub autosave_enabled: bool,
    pub default_display_mode: String,
    pub focus_mode_on_startup: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub language: String,
    pub open_window_mode: OpenWindowMode,
    pub startup_behavior: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenWindowMode {
    AggregateWindow,
    MultiWindow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSettings {
    pub copy_images_to_assets: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownSettings {
    pub math: MarkdownMathSettings,
    pub plantuml: MarkdownPlantumlSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownMathSettings {
    pub equation_numbering: String,
    pub physics_enabled: bool,
    pub syntax_mode: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownPlantumlSettings {
    pub enabled: bool,
}

fn default_markdown_settings() -> MarkdownSettings {
    MarkdownSettings {
        math: MarkdownMathSettings {
            equation_numbering: "none".to_string(),
            physics_enabled: false,
            syntax_mode: "pandoc".to_string(),
        },
        plantuml: MarkdownPlantumlSettings { enabled: true },
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    pub auto_check_on_startup: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoadResult {
    pub settings: LumaMarkSettings,
    pub settings_file_exists: bool,
    pub had_invalid_fields: bool,
    pub used_defaults_due_to_corruption: bool,
    pub corrupt_backup_path: Option<String>,
}

pub fn default_settings() -> LumaMarkSettings {
    LumaMarkSettings {
        appearance: AppearanceSettings {
            font_zoom_percent: 100,
            page_width: "adaptive".to_string(),
            sidebar_open_on_startup: true,
            theme: "light".to_string(),
        },
        editor: EditorSettings {
            autosave_enabled: false,
            default_display_mode: "livePreview".to_string(),
            focus_mode_on_startup: false,
        },
        general: GeneralSettings {
            language: "zh-CN".to_string(),
            open_window_mode: OpenWindowMode::MultiWindow,
            startup_behavior: "home".to_string(),
        },
        images: ImageSettings {
            copy_images_to_assets: false,
        },
        markdown: default_markdown_settings(),
        updates: UpdateSettings {
            auto_check_on_startup: true,
        },
        version: SETTINGS_VERSION,
    }
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join(SETTINGS_FILE_NAME)
}

pub fn load_settings(config_dir: &Path) -> Result<SettingsLoadResult, AppError> {
    let path = settings_path(config_dir);

    let settings_file_exists = path.try_exists().map_err(|_| {
        settings_io_error(
            "settings.read_failed",
            "Failed to inspect the settings file.",
        )
    })?;
    if !settings_file_exists {
        return Ok(SettingsLoadResult {
            settings: default_settings(),
            settings_file_exists: false,
            had_invalid_fields: false,
            used_defaults_due_to_corruption: false,
            corrupt_backup_path: None,
        });
    }

    let bytes = fs::read(&path).map_err(|_| {
        settings_io_error("settings.read_failed", "Failed to read the settings file.")
    })?;
    match parse_and_normalize_settings(&bytes) {
        Ok(parsed) => {
            if parsed.needs_writeback {
                save_settings(config_dir, &parsed.settings)?;
            }
            Ok(SettingsLoadResult {
                settings: parsed.settings,
                settings_file_exists: true,
                had_invalid_fields: parsed.had_invalid_fields,
                used_defaults_due_to_corruption: false,
                corrupt_backup_path: None,
            })
        }
        Err(error) if error.code == "settings.unsupported_version" => Err(error),
        Err(error)
            if error.code == "settings.invalid_json" || error.code == "settings.invalid_schema" =>
        {
            let backup_path = backup_corrupt_settings(config_dir, &path)?;
            save_settings(config_dir, &default_settings())?;
            Ok(SettingsLoadResult {
                settings: default_settings(),
                settings_file_exists: true,
                had_invalid_fields: false,
                used_defaults_due_to_corruption: true,
                corrupt_backup_path: Some(path_to_string(&backup_path)),
            })
        }
        Err(error) => Err(error),
    }
}

/// Reads the canonical file-opening mode before any Tauri window state exists.
///
/// This preserves the same migration, recovery, and future-version behavior as
/// [`load_settings`], so cold-start routing cannot diverge from the settings UI.
pub fn load_open_window_mode(config_dir: &Path) -> Result<OpenWindowMode, AppError> {
    Ok(load_settings(config_dir)?.settings.general.open_window_mode)
}

pub fn save_settings(config_dir: &Path, settings: &LumaMarkSettings) -> Result<(), AppError> {
    fs::create_dir_all(config_dir).map_err(|_| {
        settings_io_error(
            "settings.write_failed",
            "Failed to create the settings directory.",
        )
    })?;
    let normalized = normalize_settings(settings.clone())?;
    let bytes = serde_json::to_vec_pretty(&normalized).map_err(|error| {
        AppError::new(
            "settings.serialize_failed",
            format!("Failed to serialize settings: {error}"),
            true,
        )
    })?;
    write_bytes_atomically(&settings_path(config_dir), &bytes).map_err(|_| {
        settings_io_error(
            "settings.write_failed",
            "Failed to write the settings file.",
        )
    })
}

pub fn save_settings_with_acceptance_write_barrier(
    config_dir: &Path,
    settings: &LumaMarkSettings,
    write_barrier_dir: Option<&Path>,
) -> Result<(), AppError> {
    save_settings_with_acceptance_write_barrier_timeout(
        config_dir,
        settings,
        write_barrier_dir,
        ACCEPTANCE_WRITE_BARRIER_TIMEOUT,
    )
}

pub fn mark_acceptance_settings_close_entered(
    write_barrier_dir: Option<&Path>,
) -> Result<bool, AppError> {
    let Some(write_barrier_dir) = write_barrier_dir else {
        return Ok(false);
    };
    validate_acceptance_write_barrier_directory(write_barrier_dir)?;
    let arm_path = write_barrier_dir.join(ACCEPTANCE_WRITE_BARRIER_ARM);
    let close_entered_path = write_barrier_dir.join(ACCEPTANCE_WRITE_BARRIER_CLOSE_ENTERED);
    let entered_path = write_barrier_dir.join(ACCEPTANCE_WRITE_BARRIER_ENTERED);
    let release_path = write_barrier_dir.join(ACCEPTANCE_WRITE_BARRIER_RELEASE);
    if !acceptance_marker_is_regular_file(&arm_path)?
        || !acceptance_marker_is_regular_file(&entered_path)?
        || acceptance_marker_is_regular_file(&release_path)?
        || acceptance_marker_is_regular_file(&close_entered_path)?
    {
        return Err(acceptance_write_barrier_error());
    }
    create_acceptance_marker(&close_entered_path, b"close-entered\n")?;
    Ok(true)
}

fn save_settings_with_acceptance_write_barrier_timeout(
    config_dir: &Path,
    settings: &LumaMarkSettings,
    write_barrier_dir: Option<&Path>,
    timeout: Duration,
) -> Result<(), AppError> {
    if let Some(write_barrier_dir) = write_barrier_dir {
        await_acceptance_write_barrier_release(write_barrier_dir, timeout)?;
    }
    save_settings(config_dir, settings)
}

fn await_acceptance_write_barrier_release(
    write_barrier_dir: &Path,
    timeout: Duration,
) -> Result<(), AppError> {
    validate_acceptance_write_barrier_directory(write_barrier_dir)?;

    let arm_path = write_barrier_dir.join(ACCEPTANCE_WRITE_BARRIER_ARM);
    if !acceptance_marker_is_regular_file(&arm_path)? {
        return Ok(());
    }
    let close_entered_path = write_barrier_dir.join(ACCEPTANCE_WRITE_BARRIER_CLOSE_ENTERED);
    let entered_path = write_barrier_dir.join(ACCEPTANCE_WRITE_BARRIER_ENTERED);
    let release_path = write_barrier_dir.join(ACCEPTANCE_WRITE_BARRIER_RELEASE);
    if acceptance_marker_is_regular_file(&release_path)?
        || acceptance_marker_is_regular_file(&close_entered_path)?
    {
        return Err(acceptance_write_barrier_error());
    }

    create_acceptance_marker(&entered_path, b"entered\n")?;

    let deadline = Instant::now() + timeout;
    loop {
        if !acceptance_marker_is_regular_file(&arm_path)?
            || !acceptance_marker_is_regular_file(&entered_path)?
        {
            return Err(acceptance_write_barrier_error());
        }
        let close_entered = acceptance_marker_is_regular_file(&close_entered_path)?;
        if acceptance_marker_is_regular_file(&release_path)? {
            if !close_entered {
                return Err(acceptance_write_barrier_error());
            }
            break;
        }
        if Instant::now() >= deadline {
            return Err(acceptance_write_barrier_error());
        }
        thread::sleep(ACCEPTANCE_WRITE_BARRIER_POLL_INTERVAL);
    }

    // Disarm last. If an earlier cleanup step fails, subsequent writes still
    // encounter the arm marker and fail closed instead of bypassing the gate.
    for marker_path in [&release_path, &close_entered_path, &entered_path, &arm_path] {
        fs::remove_file(marker_path).map_err(|_| acceptance_write_barrier_error())?;
    }
    Ok(())
}

fn validate_acceptance_write_barrier_directory(write_barrier_dir: &Path) -> Result<(), AppError> {
    let directory_metadata =
        fs::symlink_metadata(write_barrier_dir).map_err(|_| acceptance_write_barrier_error())?;
    if !directory_metadata.is_dir() || directory_metadata.file_type().is_symlink() {
        return Err(acceptance_write_barrier_error());
    }
    Ok(())
}

fn create_acceptance_marker(path: &Path, contents: &[u8]) -> Result<(), AppError> {
    let mut marker = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|_| acceptance_write_barrier_error())?;
    marker
        .write_all(contents)
        .and_then(|()| marker.sync_all())
        .map_err(|_| acceptance_write_barrier_error())
}

fn acceptance_marker_is_regular_file(path: &Path) -> Result<bool, AppError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(acceptance_write_barrier_error()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(acceptance_write_barrier_error()),
    }
}

fn acceptance_write_barrier_error() -> AppError {
    AppError::new(
        "settings.acceptance_write_barrier_failed",
        "The acceptance settings write barrier could not complete safely.",
        false,
    )
}

struct ParsedSettings {
    settings: LumaMarkSettings,
    had_invalid_fields: bool,
    needs_writeback: bool,
}

fn parse_and_normalize_settings(bytes: &[u8]) -> Result<ParsedSettings, AppError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| {
        AppError::new(
            "settings.invalid_json",
            "Settings file is not valid JSON.",
            true,
        )
    })?;
    if !value.is_object() {
        return Err(AppError::new(
            "settings.invalid_schema",
            "Settings file does not match the expected schema.",
            true,
        ));
    }

    let (source_version, mut had_invalid_fields) = read_source_version(&value)?;
    if source_version > u64::from(SETTINGS_VERSION) {
        return Err(AppError::new(
            "settings.unsupported_version",
            "Settings file version is newer than this application supports.",
            false,
        ));
    }
    let source_version = u32::try_from(source_version).map_err(|_| {
        AppError::new(
            "settings.unsupported_version",
            "Settings file version is newer than this application supports.",
            false,
        )
    })?;

    let defaults = default_settings();
    let mut settings = defaults.clone();
    settings.appearance.theme = read_enum_field(
        value.get("appearance"),
        "theme",
        &["light", "dark", "system"],
        &defaults.appearance.theme,
        &mut had_invalid_fields,
    );
    settings.appearance.page_width = read_enum_field(
        value.get("appearance"),
        "pageWidth",
        PAGE_WIDTHS,
        &defaults.appearance.page_width,
        &mut had_invalid_fields,
    );
    if source_version < SETTINGS_VERSION && settings.appearance.page_width == "standard" {
        settings.appearance.page_width = "adaptive".to_string();
    }
    settings.appearance.font_zoom_percent = read_zoom_field(
        value.get("appearance"),
        "fontZoomPercent",
        defaults.appearance.font_zoom_percent,
        &mut had_invalid_fields,
    );
    settings.appearance.sidebar_open_on_startup = read_bool_field(
        value.get("appearance"),
        "sidebarOpenOnStartup",
        defaults.appearance.sidebar_open_on_startup,
        &mut had_invalid_fields,
    );
    settings.editor.default_display_mode = read_enum_field(
        value.get("editor"),
        "defaultDisplayMode",
        &["livePreview", "reading", "source"],
        &defaults.editor.default_display_mode,
        &mut had_invalid_fields,
    );
    settings.editor.focus_mode_on_startup = read_bool_field(
        value.get("editor"),
        "focusModeOnStartup",
        defaults.editor.focus_mode_on_startup,
        &mut had_invalid_fields,
    );
    settings.editor.autosave_enabled = {
        let autosave_missing = value
            .get("editor")
            .and_then(Value::as_object)
            .map(|editor| editor.get("autosaveEnabled").is_none())
            .unwrap_or(true);
        if source_version < SETTINGS_VERSION && autosave_missing {
            defaults.editor.autosave_enabled
        } else {
            read_bool_field(
                value.get("editor"),
                "autosaveEnabled",
                defaults.editor.autosave_enabled,
                &mut had_invalid_fields,
            )
        }
    };
    settings.general.language = read_enum_field(
        value.get("general"),
        "language",
        &["zh-CN", "en"],
        &defaults.general.language,
        &mut had_invalid_fields,
    );
    settings.general.open_window_mode =
        read_open_window_mode_field(value.get("general"), &mut had_invalid_fields);
    settings.general.startup_behavior = read_enum_field(
        value.get("general"),
        "startupBehavior",
        &["home", "restoreLastSession"],
        &defaults.general.startup_behavior,
        &mut had_invalid_fields,
    );
    settings.images.copy_images_to_assets = read_bool_field(
        value.get("images"),
        "copyImagesToAssets",
        defaults.images.copy_images_to_assets,
        &mut had_invalid_fields,
    );
    let markdown_math_missing = value
        .get("markdown")
        .and_then(Value::as_object)
        .and_then(|markdown| markdown.get("math"))
        .and_then(Value::as_object)
        .is_none();
    let markdown_plantuml_object = value
        .get("markdown")
        .and_then(Value::as_object)
        .and_then(|markdown| markdown.get("plantuml"));
    let markdown_plantuml_missing = markdown_plantuml_object
        .and_then(Value::as_object)
        .is_none();
    let plantuml_enabled_missing = markdown_plantuml_missing
        || markdown_plantuml_object
            .and_then(Value::as_object)
            .and_then(|plantuml| plantuml.get("enabled"))
            .is_none();
    if matches!(value.get("markdown"), Some(markdown) if !markdown.is_object())
        || value
            .get("markdown")
            .and_then(Value::as_object)
            .and_then(|markdown| markdown.get("math"))
            .is_some_and(|math| !math.is_object())
        || markdown_plantuml_object.is_some_and(|plantuml| !plantuml.is_object())
    {
        had_invalid_fields = true;
    }
    let math_section = value
        .get("markdown")
        .and_then(Value::as_object)
        .and_then(|markdown| markdown.get("math"));
    if markdown_math_missing {
        settings.markdown.math = defaults.markdown.math.clone();
    } else {
        settings.markdown.math.syntax_mode = read_enum_field(
            math_section,
            "syntaxMode",
            &["pandoc", "legacy", "disabled"],
            &defaults.markdown.math.syntax_mode,
            &mut had_invalid_fields,
        );
        settings.markdown.math.equation_numbering = read_enum_field(
            math_section,
            "equationNumbering",
            &["none", "ams", "all"],
            &defaults.markdown.math.equation_numbering,
            &mut had_invalid_fields,
        );
        settings.markdown.math.physics_enabled = read_bool_field(
            math_section,
            "physicsEnabled",
            defaults.markdown.math.physics_enabled,
            &mut had_invalid_fields,
        );
    }
    if plantuml_enabled_missing {
        settings.markdown.plantuml = defaults.markdown.plantuml.clone();
    } else {
        settings.markdown.plantuml.enabled = read_bool_field(
            markdown_plantuml_object,
            "enabled",
            defaults.markdown.plantuml.enabled,
            &mut had_invalid_fields,
        );
    }
    settings.updates.auto_check_on_startup =
        if source_version < SETTINGS_VERSION && value.get("updates").is_none() {
            defaults.updates.auto_check_on_startup
        } else {
            read_bool_field(
                value.get("updates"),
                "autoCheckOnStartup",
                defaults.updates.auto_check_on_startup,
                &mut had_invalid_fields,
            )
        };
    settings.version = SETTINGS_VERSION;

    Ok(ParsedSettings {
        settings,
        had_invalid_fields,
        needs_writeback: source_version < SETTINGS_VERSION
            || had_invalid_fields
            || markdown_math_missing
            || plantuml_enabled_missing,
    })
}

fn normalize_settings(mut settings: LumaMarkSettings) -> Result<LumaMarkSettings, AppError> {
    if settings.version > SETTINGS_VERSION {
        return Err(AppError::new(
            "settings.unsupported_version",
            "Settings file version is newer than this application supports.",
            false,
        ));
    }

    settings.version = SETTINGS_VERSION;
    settings.appearance.theme = normalize_enum(
        &settings.appearance.theme,
        &["light", "dark", "system"],
        "light",
    );
    settings.appearance.page_width = normalize_enum(
        &settings.appearance.page_width,
        PAGE_WIDTHS,
        "adaptive",
    );
    settings.appearance.font_zoom_percent =
        normalize_font_zoom(settings.appearance.font_zoom_percent, 100);
    settings.general.language =
        normalize_enum(&settings.general.language, &["zh-CN", "en"], "zh-CN");
    settings.general.startup_behavior = normalize_enum(
        &settings.general.startup_behavior,
        &["home", "restoreLastSession"],
        "home",
    );
    settings.editor.default_display_mode = normalize_enum(
        &settings.editor.default_display_mode,
        &["livePreview", "reading", "source"],
        "livePreview",
    );
    settings.version = SETTINGS_VERSION;

    Ok(settings)
}

fn normalize_enum(value: &str, allowed: &[&str], default: &str) -> String {
    if allowed.contains(&value) {
        value.to_string()
    } else {
        default.to_string()
    }
}

fn normalize_font_zoom(value: u32, default: u32) -> u32 {
    if (50..=250).contains(&value) && value.is_multiple_of(10) {
        value
    } else {
        default
    }
}

fn backup_corrupt_settings(config_dir: &Path, settings_path: &Path) -> Result<PathBuf, AppError> {
    fs::create_dir_all(config_dir).map_err(|_| {
        settings_io_error(
            "settings.backup_failed",
            "Failed to create the settings backup directory.",
        )
    })?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| {
            AppError::new(
                "settings.backup_failed",
                "System clock is unavailable for settings backup.",
                true,
            )
        })?
        .as_millis();
    let mut suffix = 0_u32;
    let backup_path = loop {
        let suffix_text = if suffix == 0 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let candidate = config_dir.join(format!("settings.corrupt-{timestamp}{suffix_text}.json"));
        if !candidate.exists() {
            break candidate;
        }
        suffix += 1;
    };
    fs::rename(settings_path, &backup_path).map_err(|_| {
        settings_io_error(
            "settings.backup_failed",
            "Failed to preserve the corrupt settings file.",
        )
    })?;
    Ok(backup_path)
}

struct DecimalVersionMagnitude {
    decimal_shift: i64,
    significant_digits: String,
}

impl DecimalVersionMagnitude {
    fn from_number(number: &Number) -> Option<Self> {
        let raw = number.as_str();
        if raw.starts_with('-') {
            return None;
        }
        let (significand, exponent) = match raw.split_once(['e', 'E']) {
            Some((significand, exponent)) => {
                (significand, parse_saturating_json_exponent(exponent)?)
            }
            None => (raw, 0),
        };
        let (integer, fraction) = significand
            .split_once('.')
            .map_or((significand, ""), |parts| parts);
        if integer.is_empty()
            || !integer.bytes().all(|byte| byte.is_ascii_digit())
            || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }

        let mut digits = String::with_capacity(integer.len() + fraction.len());
        digits.push_str(integer);
        digits.push_str(fraction);
        let significant_digits = digits.trim_start_matches('0').to_string();
        let fraction_len = i64::try_from(fraction.len()).unwrap_or(i64::MAX);

        Some(Self {
            decimal_shift: exponent.saturating_sub(fraction_len),
            significant_digits,
        })
    }

    fn exceeds(&self, limit: u32) -> bool {
        if self.significant_digits.is_empty() {
            return false;
        }
        if limit == 0 {
            return true;
        }

        let integer_digit_count = i128::try_from(self.significant_digits.len())
            .unwrap_or(i128::MAX)
            .saturating_add(i128::from(self.decimal_shift));
        let limit_digits = limit.to_string();
        let limit_digit_count = i128::try_from(limit_digits.len()).unwrap_or(i128::MAX);
        match integer_digit_count.cmp(&limit_digit_count) {
            Ordering::Greater => return true,
            Ordering::Less => return false,
            Ordering::Equal => {}
        }

        for (index, limit_digit) in limit_digits.bytes().enumerate() {
            let version_digit = self
                .significant_digits
                .as_bytes()
                .get(index)
                .copied()
                .unwrap_or(b'0');
            match version_digit.cmp(&limit_digit) {
                Ordering::Greater => return true,
                Ordering::Less => return false,
                Ordering::Equal => {}
            }
        }

        self.significant_digits
            .as_bytes()
            .get(limit_digits.len()..)
            .is_some_and(|fraction| fraction.iter().any(|digit| *digit != b'0'))
    }

    fn exact_u64(&self) -> Option<u64> {
        if self.significant_digits.is_empty() {
            return Some(0);
        }
        if self.decimal_shift >= 0 {
            let exponent = u32::try_from(self.decimal_shift).ok()?;
            if exponent > 19 {
                return None;
            }
            return self
                .significant_digits
                .parse::<u64>()
                .ok()?
                .checked_mul(10_u64.checked_pow(exponent)?);
        }

        let required_trailing_zeros = self
            .decimal_shift
            .checked_neg()
            .and_then(|value| usize::try_from(value).ok())?;
        if required_trailing_zeros > self.significant_digits.len() {
            return None;
        }
        let integer_end = self.significant_digits.len() - required_trailing_zeros;
        if self.significant_digits.as_bytes()[integer_end..]
            .iter()
            .any(|digit| *digit != b'0')
        {
            return None;
        }
        self.significant_digits[..integer_end].parse::<u64>().ok()
    }
}

fn parse_saturating_json_exponent(raw: &str) -> Option<i64> {
    let (negative, digits) = if let Some(digits) = raw.strip_prefix('-') {
        (true, digits)
    } else {
        (false, raw.strip_prefix('+').unwrap_or(raw))
    };
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let magnitude = digits.bytes().fold(0_i64, |value, digit| {
        value
            .saturating_mul(10)
            .saturating_add(i64::from(digit - b'0'))
    });
    Some(if negative {
        magnitude.saturating_neg()
    } else {
        magnitude
    })
}

fn read_source_version(value: &Value) -> Result<(u64, bool), AppError> {
    match value.get("version") {
        None => Ok((0, false)),
        Some(Value::Number(version)) => {
            if let Some(version) = version.as_u64() {
                return Ok((version, false));
            }
            let Some(version) = DecimalVersionMagnitude::from_number(version) else {
                return Ok((0, true));
            };
            if version.exceeds(SETTINGS_VERSION) {
                Err(AppError::new(
                    "settings.unsupported_version",
                    "Settings file version is newer than this application supports.",
                    false,
                ))
            } else if let Some(version) = version.exact_u64() {
                Ok((version, false))
            } else {
                Ok((0, true))
            }
        }
        Some(_) => Ok((0, true)),
    }
}

fn read_enum_field(
    section: Option<&Value>,
    key: &str,
    allowed: &[&str],
    default: &str,
    had_invalid_fields: &mut bool,
) -> String {
    match section
        .and_then(Value::as_object)
        .and_then(|section| section.get(key))
        .and_then(Value::as_str)
    {
        Some(value) if allowed.contains(&value) => value.to_string(),
        _ => {
            *had_invalid_fields = true;
            default.to_string()
        }
    }
}

fn read_bool_field(
    section: Option<&Value>,
    key: &str,
    default: bool,
    had_invalid_fields: &mut bool,
) -> bool {
    match section
        .and_then(Value::as_object)
        .and_then(|section| section.get(key))
        .and_then(Value::as_bool)
    {
        Some(value) => value,
        None => {
            *had_invalid_fields = true;
            default
        }
    }
}

fn read_open_window_mode_field(
    section: Option<&Value>,
    had_invalid_fields: &mut bool,
) -> OpenWindowMode {
    match section
        .and_then(Value::as_object)
        .and_then(|section| section.get("openWindowMode"))
        .and_then(Value::as_str)
    {
        Some("aggregateWindow") => OpenWindowMode::AggregateWindow,
        Some("multiWindow") => OpenWindowMode::MultiWindow,
        _ => {
            *had_invalid_fields = true;
            OpenWindowMode::MultiWindow
        }
    }
}

fn read_zoom_field(
    section: Option<&Value>,
    key: &str,
    default: u32,
    had_invalid_fields: &mut bool,
) -> u32 {
    match section
        .and_then(Value::as_object)
        .and_then(|section| section.get(key))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
    {
        Some(value) if (50..=250).contains(&value) && value.is_multiple_of(10) => value,
        _ => {
            *had_invalid_fields = true;
            default
        }
    }
}

fn settings_io_error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, true)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lumamark-settings-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("test directory should be created");
        dir
    }

    #[test]
    fn load_settings_returns_defaults_without_creating_file() {
        let dir = unique_test_dir("missing");
        let result = load_settings(&dir).expect("load should succeed");

        assert_eq!(result.settings, default_settings());
        assert!(!result.settings_file_exists);
        assert!(!result.used_defaults_due_to_corruption);
        assert!(!settings_path(&dir).exists());
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn cold_start_reader_returns_the_persisted_open_window_mode() {
        let dir = unique_test_dir("cold-start-open-window-mode");
        let mut settings = default_settings();
        settings.general.open_window_mode = OpenWindowMode::AggregateWindow;
        save_settings(&dir, &settings).expect("save should succeed");

        let mode = load_open_window_mode(&dir).expect("cold-start read should succeed");

        assert_eq!(mode, OpenWindowMode::AggregateWindow);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn cold_start_reader_rejects_a_future_version_without_rewriting_it() {
        let dir = unique_test_dir("cold-start-future-version");
        let path = settings_path(&dir);
        let raw = br#"{"version":99,"future":"preserve exactly"}"#;
        fs::write(&path, raw).expect("write future settings");

        let error = load_open_window_mode(&dir).expect_err("future version must fail closed");

        assert_eq!(error.code, "settings.unsupported_version");
        assert_eq!(fs::read(&path).expect("read original"), raw);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn save_then_load_round_trips_fields() {
        let dir = unique_test_dir("round-trip");
        let mut settings = default_settings();
        settings.appearance.theme = "dark".to_string();
        settings.appearance.font_zoom_percent = 120;
        settings.images.copy_images_to_assets = true;
        settings.general.language = "en".to_string();
        settings.editor.default_display_mode = "source".to_string();

        save_settings(&dir, &settings).expect("save should succeed");
        let loaded = load_settings(&dir).expect("load should succeed");

        assert_eq!(loaded.settings, settings);
        assert!(!loaded.used_defaults_due_to_corruption);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn save_uses_atomic_write_without_temp_residue() {
        let dir = unique_test_dir("atomic");
        save_settings(&dir, &default_settings()).expect("save should succeed");

        let entries: Vec<_> = fs::read_dir(&dir)
            .expect("read dir")
            .map(|entry| entry.expect("entry").file_name())
            .collect();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0], SETTINGS_FILE_NAME);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn corrupt_json_backs_up_and_returns_defaults() {
        let dir = unique_test_dir("corrupt");
        let path = settings_path(&dir);
        let corrupt = b"{not-json";
        fs::write(&path, corrupt).expect("write corrupt");

        let result = load_settings(&dir).expect("load should recover");

        assert!(result.used_defaults_due_to_corruption);
        assert_eq!(result.settings, default_settings());
        let backup = result.corrupt_backup_path.expect("backup path");
        assert!(
            Path::new(&backup)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(
                    |name| name.starts_with("settings.corrupt-") && name.ends_with(".json")
                ),
            "backup name should use settings.corrupt-<timestamp>.json"
        );
        let backup_bytes = fs::read(&backup).expect("read backup");
        assert_eq!(backup_bytes, corrupt);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn save_creates_missing_config_directory() {
        let parent = unique_test_dir("parent");
        let dir = parent.join("nested-config");
        save_settings(&dir, &default_settings()).expect("save should create dirs");
        assert!(settings_path(&dir).exists());
        fs::remove_dir_all(parent).expect("cleanup");
    }

    #[test]
    fn unknown_fields_are_ignored_and_version_is_not_downgraded_on_write() {
        let dir = unique_test_dir("unknown-fields");
        let path = settings_path(&dir);
        let raw = r#"{
            "appearance": {
                "fontZoomPercent": 100,
                "pageWidth": "standard",
                "sidebarOpenOnStartup": true,
                "theme": "light",
                "extraFuture": true
            },
            "editor": {
                "defaultDisplayMode": "livePreview",
                "focusModeOnStartup": false
            },
            "general": {
                "language": "zh-CN",
                "startupBehavior": "home"
            },
            "images": {
                "copyImagesToAssets": false
            },
            "version": 1,
            "pluginBucket": {"x": 1}
        }"#;
        fs::write(&path, raw).expect("write");

        let loaded = load_settings(&dir).expect("load");
        assert_eq!(loaded.settings.version, SETTINGS_VERSION);

        save_settings(&dir, &loaded.settings).expect("save");
        let written: Value =
            serde_json::from_slice(&fs::read(&path).expect("read")).expect("parse");
        assert_eq!(written["version"], SETTINGS_VERSION);
        assert!(written.get("pluginBucket").is_none());
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn lower_version_is_normalized_up_on_save() {
        let dir = unique_test_dir("lower-version");
        let path = settings_path(&dir);
        let mut settings = default_settings();
        settings.version = 0;
        let raw = serde_json::to_vec_pretty(&settings).expect("serialize");
        fs::write(&path, raw).expect("write");

        let loaded = load_settings(&dir).expect("load");
        assert_eq!(loaded.settings.version, SETTINGS_VERSION);
        save_settings(&dir, &loaded.settings).expect("save");
        let written: Value =
            serde_json::from_slice(&fs::read(&path).expect("read")).expect("parse");
        assert_eq!(written["version"], SETTINGS_VERSION);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn invalid_font_zoom_recovers_to_default() {
        let mut settings = default_settings();
        settings.appearance.font_zoom_percent = 9999;
        let normalized = normalize_settings(settings).expect("normalize");
        assert_eq!(normalized.appearance.font_zoom_percent, 100);

        let mut settings = default_settings();
        settings.appearance.font_zoom_percent = 0;
        let normalized = normalize_settings(settings).expect("normalize");
        assert_eq!(normalized.appearance.font_zoom_percent, 100);
    }

    #[test]
    fn defaults_match_the_v4_contract() {
        let value = serde_json::to_value(default_settings()).expect("serialize defaults");

        assert_eq!(SETTINGS_VERSION, 4);
        assert_eq!(value["version"], 4);
        assert_eq!(value["appearance"]["fontZoomPercent"], 100);
        assert_eq!(value["editor"]["autosaveEnabled"], false);
        assert_eq!(value["updates"]["autoCheckOnStartup"], true);
    }

    #[test]
    fn v2_documents_migrate_autosave_off_without_invalid_fields() {
        let raw = serde_json::json!({
            "appearance": {
                "fontZoomPercent": 100,
                "pageWidth": "standard",
                "sidebarOpenOnStartup": true,
                "theme": "light"
            },
            "editor": {
                "defaultDisplayMode": "livePreview",
                "focusModeOnStartup": false
            },
            "general": {
                "language": "zh-CN",
                "openWindowMode": "multiWindow",
                "startupBehavior": "home"
            },
            "images": { "copyImagesToAssets": false },
            "updates": { "autoCheckOnStartup": true },
            "version": 2
        });
        let parsed = parse_and_normalize_settings(&serde_json::to_vec(&raw).expect("serialize"))
            .expect("v2 settings should migrate");

        assert!(!parsed.had_invalid_fields);
        assert_eq!(parsed.settings.version, SETTINGS_VERSION);
        assert!(!parsed.settings.editor.autosave_enabled);
        assert_eq!(parsed.settings.appearance.page_width, "adaptive");
        assert_eq!(parsed.settings.markdown.math.syntax_mode, "pandoc");
        assert_eq!(parsed.settings.markdown.math.equation_numbering, "none");
        assert!(!parsed.settings.markdown.math.physics_enabled);
        assert!(parsed.needs_writeback);
    }

    #[test]
    fn existing_v3_documents_accept_missing_markdown_math_defaults() {
        let raw = serde_json::json!({
            "appearance": {
                "fontZoomPercent": 100,
                "pageWidth": "standard",
                "sidebarOpenOnStartup": true,
                "theme": "light"
            },
            "editor": {
                "autosaveEnabled": false,
                "defaultDisplayMode": "livePreview",
                "focusModeOnStartup": false
            },
            "general": {
                "language": "zh-CN",
                "openWindowMode": "multiWindow",
                "startupBehavior": "home"
            },
            "images": { "copyImagesToAssets": false },
            "updates": { "autoCheckOnStartup": true },
            "version": 3
        });
        let parsed = parse_and_normalize_settings(&serde_json::to_vec(&raw).expect("serialize"))
            .expect("v3 settings without markdown.math should migrate");

        assert!(!parsed.had_invalid_fields);
        assert_eq!(parsed.settings.markdown.math.syntax_mode, "pandoc");
        assert_eq!(parsed.settings.markdown.math.equation_numbering, "none");
        assert!(!parsed.settings.markdown.math.physics_enabled);
        assert!(parsed.settings.markdown.plantuml.enabled);
        assert_eq!(parsed.settings.appearance.page_width, "adaptive");
        assert!(parsed.needs_writeback);
    }

    #[test]
    fn v3_standard_page_width_migrates_to_adaptive_and_keeps_explicit_presets() {
        let standard = serde_json::json!({
            "appearance": {
                "fontZoomPercent": 100,
                "pageWidth": "standard",
                "sidebarOpenOnStartup": true,
                "theme": "light"
            },
            "editor": {
                "autosaveEnabled": false,
                "defaultDisplayMode": "livePreview",
                "focusModeOnStartup": false
            },
            "general": {
                "language": "zh-CN",
                "openWindowMode": "multiWindow",
                "startupBehavior": "home"
            },
            "images": { "copyImagesToAssets": false },
            "updates": { "autoCheckOnStartup": true },
            "version": 3
        });
        let parsed = parse_and_normalize_settings(&serde_json::to_vec(&standard).expect("serialize"))
            .expect("v3 standard page width should migrate");
        assert!(!parsed.had_invalid_fields);
        assert_eq!(parsed.settings.appearance.page_width, "adaptive");

        let mut wide = standard.clone();
        wide["appearance"]["pageWidth"] = serde_json::json!("wide");
        let wide_parsed = parse_and_normalize_settings(&serde_json::to_vec(&wide).expect("serialize"))
            .expect("v3 wide page width should be kept");
        assert_eq!(wide_parsed.settings.appearance.page_width, "wide");

        let mut current_standard = standard.clone();
        current_standard["version"] = serde_json::json!(SETTINGS_VERSION);
        current_standard["appearance"]["pageWidth"] = serde_json::json!("standard");
        let kept = parse_and_normalize_settings(
            &serde_json::to_vec(&current_standard).expect("serialize"),
        )
        .expect("current standard page width should be kept");
        assert_eq!(kept.settings.appearance.page_width, "standard");
    }

    #[test]
    fn existing_v3_documents_accept_missing_markdown_plantuml_defaults() {
        let raw = serde_json::json!({
            "appearance": {
                "fontZoomPercent": 100,
                "pageWidth": "standard",
                "sidebarOpenOnStartup": true,
                "theme": "light"
            },
            "editor": {
                "autosaveEnabled": false,
                "defaultDisplayMode": "livePreview",
                "focusModeOnStartup": false
            },
            "general": {
                "language": "zh-CN",
                "openWindowMode": "multiWindow",
                "startupBehavior": "home"
            },
            "images": { "copyImagesToAssets": false },
            "markdown": {
                "math": {
                    "equationNumbering": "ams",
                    "physicsEnabled": true,
                    "syntaxMode": "legacy"
                }
            },
            "updates": { "autoCheckOnStartup": true },
            "version": 3
        });
        let parsed = parse_and_normalize_settings(&serde_json::to_vec(&raw).expect("serialize"))
            .expect("v3 settings without markdown.plantuml should migrate");

        assert!(!parsed.had_invalid_fields);
        assert_eq!(parsed.settings.markdown.math.syntax_mode, "legacy");
        assert!(parsed.settings.markdown.math.physics_enabled);
        assert!(parsed.settings.markdown.plantuml.enabled);
        assert!(parsed.needs_writeback);
    }

    #[test]
    fn missing_markdown_math_does_not_reset_explicit_plantuml_opt_out() {
        let raw = serde_json::json!({
            "appearance": {
                "fontZoomPercent": 100,
                "pageWidth": "standard",
                "sidebarOpenOnStartup": true,
                "theme": "light"
            },
            "editor": {
                "autosaveEnabled": false,
                "defaultDisplayMode": "livePreview",
                "focusModeOnStartup": false
            },
            "general": {
                "language": "zh-CN",
                "openWindowMode": "multiWindow",
                "startupBehavior": "home"
            },
            "images": { "copyImagesToAssets": false },
            "markdown": {
                "plantuml": { "enabled": false }
            },
            "updates": { "autoCheckOnStartup": true },
            "version": 3
        });
        let parsed = parse_and_normalize_settings(&serde_json::to_vec(&raw).expect("serialize"))
            .expect("v3 settings with plantuml only should keep the opt-out");

        assert!(!parsed.had_invalid_fields);
        assert_eq!(parsed.settings.markdown.math.syntax_mode, "pandoc");
        assert!(!parsed.settings.markdown.plantuml.enabled);
        assert!(parsed.needs_writeback);
    }

    #[test]
    fn defaults_enums_and_zoom_match_the_shared_contract_fixture() {
        let contract: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/settings-v4-contract.json"
        ))
        .expect("shared settings contract should be valid json");
        let defaults = serde_json::to_value(default_settings()).expect("serialize defaults");

        assert_eq!(defaults, contract["defaults"]);

        let allowed_enums = contract["allowedEnums"]
            .as_object()
            .expect("allowedEnums should be an object");
        for (path, allowed_values) in allowed_enums {
            let (section, field) = path
                .split_once('.')
                .expect("enum fixture paths should contain one section separator");
            for allowed_value in allowed_values
                .as_array()
                .expect("allowed enum values should be an array")
            {
                let mut raw = defaults.clone();
                raw[section][field] = allowed_value.clone();
                let bytes = serde_json::to_vec(&raw).expect("serialize enum fixture");
                let parsed = parse_and_normalize_settings(&bytes).expect("parse enum fixture");
                let normalized =
                    serde_json::to_value(parsed.settings).expect("serialize normalized settings");

                assert!(
                    !parsed.had_invalid_fields,
                    "{path} rejected {allowed_value}"
                );
                assert_eq!(normalized[section][field], *allowed_value);
            }
        }

        let zoom = &contract["fontZoom"];
        let zoom_default = zoom["default"].as_u64().expect("zoom default") as u32;
        let zoom_min = zoom["min"].as_u64().expect("zoom min") as u32;
        let zoom_max = zoom["max"].as_u64().expect("zoom max") as u32;
        let zoom_step = zoom["step"].as_u64().expect("zoom step") as usize;
        assert_eq!(
            default_settings().appearance.font_zoom_percent,
            zoom_default
        );

        for valid_zoom in (zoom_min..=zoom_max).step_by(zoom_step) {
            let mut raw = defaults.clone();
            raw["appearance"]["fontZoomPercent"] = Value::from(valid_zoom);
            let bytes = serde_json::to_vec(&raw).expect("serialize zoom fixture");
            let parsed = parse_and_normalize_settings(&bytes).expect("parse zoom fixture");

            assert!(
                !parsed.had_invalid_fields,
                "valid zoom {valid_zoom} rejected"
            );
            assert_eq!(parsed.settings.appearance.font_zoom_percent, valid_zoom);
        }

        for invalid_zoom in [zoom_min - 1, zoom_min + 1, zoom_max + 1] {
            let mut raw = defaults.clone();
            raw["appearance"]["fontZoomPercent"] = Value::from(invalid_zoom);
            let bytes = serde_json::to_vec(&raw).expect("serialize invalid zoom fixture");
            let parsed = parse_and_normalize_settings(&bytes).expect("parse invalid zoom fixture");

            assert!(
                parsed.had_invalid_fields,
                "invalid zoom {invalid_zoom} accepted"
            );
            assert_eq!(parsed.settings.appearance.font_zoom_percent, zoom_default);
        }
    }

    #[test]
    fn invalid_fields_recover_independently_to_defaults() {
        let dir = unique_test_dir("invalid-fields");
        let path = settings_path(&dir);
        let raw = br#"{
            "appearance": {
                "fontZoomPercent": 125,
                "pageWidth": "poster",
                "sidebarOpenOnStartup": "yes",
                "theme": "sepia"
            },
            "editor": {
                "defaultDisplayMode": "unknown",
                "focusModeOnStartup": "yes"
            },
            "general": {
                "language": "fr",
                "openWindowMode": "sameWindow",
                "startupBehavior": "unknown"
            },
            "images": { "copyImagesToAssets": "yes" },
            "updates": { "autoCheckOnStartup": "yes" },
            "version": 2
        }"#;
        fs::write(&path, raw).expect("write invalid fields");

        let loaded = load_settings(&dir).expect("field recovery should succeed");
        let value = serde_json::to_value(&loaded.settings).expect("serialize normalized");

        assert!(loaded.settings_file_exists);
        assert!(loaded.had_invalid_fields);
        assert!(!loaded.used_defaults_due_to_corruption);
        assert_eq!(value["appearance"]["fontZoomPercent"], 100);
        assert_eq!(value["appearance"]["pageWidth"], "adaptive");
        assert_eq!(value["general"]["openWindowMode"], "multiWindow");
        assert_eq!(value["updates"]["autoCheckOnStartup"], true);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn current_document_missing_open_window_mode_is_normalized_and_rewritten() {
        let dir = unique_test_dir("v2-missing-open-window-mode");
        let path = settings_path(&dir);
        let mut value = serde_json::to_value(default_settings()).expect("serialize defaults");
        value["general"]
            .as_object_mut()
            .expect("general object")
            .remove("openWindowMode");
        fs::write(&path, serde_json::to_vec_pretty(&value).expect("serialize"))
            .expect("write v2 settings");

        let loaded = load_settings(&dir).expect("v2 normalization should succeed");
        let persisted: Value = serde_json::from_slice(&fs::read(&path).expect("read normalized"))
            .expect("normalized settings should be valid json");

        assert!(loaded.had_invalid_fields);
        assert_eq!(persisted["general"]["openWindowMode"], "multiWindow");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn v1_document_migrates_to_current_with_update_and_autosave_defaults() {
        let dir = unique_test_dir("v1-migration");
        let path = settings_path(&dir);
        let mut value = serde_json::to_value(default_settings()).expect("serialize defaults");
        value["version"] = Value::from(1);
        value
            .as_object_mut()
            .expect("root object")
            .remove("updates");
        value["general"]
            .as_object_mut()
            .expect("general object")
            .remove("openWindowMode");
        fs::write(&path, serde_json::to_vec_pretty(&value).expect("serialize")).expect("write v1");

        let loaded = load_settings(&dir).expect("v1 migration should succeed");
        let normalized = serde_json::to_value(&loaded.settings).expect("serialize normalized");

        assert!(loaded.had_invalid_fields);
        assert_eq!(normalized["version"], SETTINGS_VERSION);
        assert_eq!(normalized["general"]["openWindowMode"], "multiWindow");
        assert_eq!(normalized["updates"]["autoCheckOnStartup"], true);
        assert_eq!(normalized["editor"]["autosaveEnabled"], false);
        let persisted: Value = serde_json::from_slice(&fs::read(&path).expect("read migrated"))
            .expect("migrated settings should be valid json");
        assert_eq!(persisted["version"], SETTINGS_VERSION);
        assert_eq!(persisted["general"]["openWindowMode"], "multiWindow");
        assert_eq!(persisted["updates"]["autoCheckOnStartup"], true);
        assert_eq!(persisted["editor"]["autosaveEnabled"], false);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn versionless_document_is_persisted_as_current_without_becoming_invalid() {
        let dir = unique_test_dir("v0-migration");
        let path = settings_path(&dir);
        let mut value = serde_json::to_value(default_settings()).expect("serialize defaults");
        value
            .as_object_mut()
            .expect("root object")
            .remove("version");
        value
            .as_object_mut()
            .expect("root object")
            .remove("updates");
        value["general"]
            .as_object_mut()
            .expect("general object")
            .remove("openWindowMode");
        fs::write(&path, serde_json::to_vec_pretty(&value).expect("serialize")).expect("write v0");

        let loaded = load_settings(&dir).expect("v0 migration should succeed");
        let persisted: Value = serde_json::from_slice(&fs::read(&path).expect("read migrated"))
            .expect("migrated settings should be valid json");

        assert!(loaded.had_invalid_fields);
        assert!(!loaded.used_defaults_due_to_corruption);
        assert_eq!(loaded.settings.version, SETTINGS_VERSION);
        assert_eq!(persisted["version"], SETTINGS_VERSION);
        assert_eq!(persisted["general"]["openWindowMode"], "multiWindow");
        assert_eq!(persisted["updates"]["autoCheckOnStartup"], true);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn invalid_version_types_keep_the_v0_recovery_contract() {
        for (case, invalid_version) in [
            ("string", Value::String("3".to_string())),
            ("negative", Value::from(-1)),
            ("fraction", Value::from(1.5)),
        ] {
            let mut document =
                serde_json::to_value(default_settings()).expect("serialize defaults");
            document["version"] = invalid_version;
            let bytes = serde_json::to_vec(&document).expect("serialize invalid version");

            let parsed = parse_and_normalize_settings(&bytes)
                .unwrap_or_else(|error| panic!("{case} should recover: {error:?}"));

            assert!(parsed.had_invalid_fields, "{case} should be invalid");
            assert!(parsed.needs_writeback, "{case} should migrate from v0");
            assert_eq!(parsed.settings.version, SETTINGS_VERSION);
        }
    }

    #[test]
    fn version_number_rejects_future_fractional_values_without_filesystem_mutation() {
        for (case, raw) in [
            (
                "four-point-five",
                &br#"{"version":4.5,"future":"preserve exactly"}"#[..],
            ),
            (
                "five-point-five",
                &br#"{"version":5.5,"future":"preserve exactly"}"#[..],
            ),
        ] {
            let dir = unique_test_dir(case);
            let path = settings_path(&dir);
            fs::write(&path, raw).expect("write future settings");

            let error = load_settings(&dir).expect_err("future version must be rejected");

            assert_eq!(error.code, "settings.unsupported_version");
            assert_eq!(fs::read(&path).expect("read original"), raw);
            let entries = fs::read_dir(&dir)
                .expect("read dir")
                .map(|entry| entry.expect("read entry").file_name())
                .collect::<Vec<_>>();
            assert_eq!(entries, [SETTINGS_FILE_NAME]);
            fs::remove_dir_all(dir).expect("cleanup");
        }
    }

    #[test]
    fn version_number_rejects_overflowing_exponent_without_filesystem_mutation() {
        let dir = unique_test_dir("future-version-overflowing-exponent");
        let path = settings_path(&dir);
        let raw = br#"{"version":1e400,"future":"preserve exactly"}"#;
        fs::write(&path, raw).expect("write future settings");

        let error = load_settings(&dir).expect_err("future version must be rejected");

        assert_eq!(error.code, "settings.unsupported_version");
        assert_eq!(fs::read(&path).expect("read original"), raw);
        let entries = fs::read_dir(&dir)
            .expect("read dir")
            .map(|entry| entry.expect("read entry").file_name())
            .collect::<Vec<_>>();
        assert_eq!(entries, [SETTINGS_FILE_NAME]);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn version_number_accepts_current_decimal_and_exponent_forms_without_rewrite() {
        for (case, version) in [("current-decimal", "4.0"), ("current-exponent", "4e0")] {
            let dir = unique_test_dir(case);
            let path = settings_path(&dir);
            let raw = serde_json::to_string(&default_settings())
                .expect("serialize defaults")
                .replace(
                    &format!("\"version\":{SETTINGS_VERSION}"),
                    &format!("\"version\":{version}"),
                )
                .into_bytes();
            fs::write(&path, &raw).expect("write compatible settings");

            let loaded = load_settings(&dir).expect("current version should load");

            assert!(!loaded.had_invalid_fields);
            assert_eq!(loaded.settings.version, SETTINGS_VERSION);
            assert_eq!(fs::read(&path).expect("read original"), raw);
            let entries = fs::read_dir(&dir)
                .expect("read dir")
                .map(|entry| entry.expect("read entry").file_name())
                .collect::<Vec<_>>();
            assert_eq!(entries, [SETTINGS_FILE_NAME]);
            fs::remove_dir_all(dir).expect("cleanup");
        }
    }

    #[test]
    fn future_version_is_unsupported_without_backup_or_rewrite() {
        let dir = unique_test_dir("future-version");
        let path = settings_path(&dir);
        let raw = br#"{"version":99,"future":"preserve exactly"}"#;
        fs::write(&path, raw).expect("write future settings");

        let error = load_settings(&dir).expect_err("future version must be rejected");

        assert_eq!(error.code, "settings.unsupported_version");
        assert_eq!(fs::read(&path).expect("read original"), raw);
        let backups = fs::read_dir(&dir)
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.corrupt-")
            })
            .count();
        assert_eq!(backups, 0);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn future_version_beyond_u32_is_unsupported_without_backup_or_rewrite() {
        let dir = unique_test_dir("future-version-beyond-u32");
        let path = settings_path(&dir);
        let raw = br#"{"version":4294967296,"future":"preserve exactly"}"#;
        fs::write(&path, raw).expect("write future settings");

        let error = load_settings(&dir).expect_err("future version must be rejected");

        assert_eq!(error.code, "settings.unsupported_version");
        assert_eq!(fs::read(&path).expect("read original"), raw);
        let backups = fs::read_dir(&dir)
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.corrupt-")
            })
            .count();
        assert_eq!(backups, 0);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn future_version_beyond_u64_is_unsupported_without_filesystem_mutation() {
        let dir = unique_test_dir("future-version-beyond-u64");
        let path = settings_path(&dir);
        let raw = br#"{"version":18446744073709551616,"future":"preserve exactly"}"#;
        fs::write(&path, raw).expect("write future settings");

        let error = load_settings(&dir).expect_err("future version must be rejected");

        assert_eq!(error.code, "settings.unsupported_version");
        assert_eq!(fs::read(&path).expect("read original"), raw);
        let mut entries = fs::read_dir(&dir)
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("read entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect::<Vec<_>>();
        entries.sort();
        assert_eq!(entries, [SETTINGS_FILE_NAME.to_string()]);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn corrupt_json_is_backed_up_once_and_replaced_with_valid_defaults() {
        let dir = unique_test_dir("corrupt-once");
        let path = settings_path(&dir);
        let corrupt = b"{not-json";
        fs::write(&path, corrupt).expect("write corrupt");

        let first = load_settings(&dir).expect("first load should recover");
        let backup = first.corrupt_backup_path.expect("backup path");
        let second = load_settings(&dir).expect("second load should use recovered file");

        assert_eq!(fs::read(backup).expect("read backup"), corrupt);
        assert!(!second.used_defaults_due_to_corruption);
        assert!(second.corrupt_backup_path.is_none());
        let recovered: Value = serde_json::from_slice(&fs::read(&path).expect("read recovered"))
            .expect("recovered settings should be valid json");
        assert_eq!(recovered["version"], SETTINGS_VERSION);
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn read_io_failure_has_a_settings_specific_code() {
        let dir = unique_test_dir("read-error");
        fs::create_dir(settings_path(&dir)).expect("create directory at settings path");

        let error = load_settings(&dir).expect_err("directory cannot be read as settings json");

        assert_eq!(error.code, "settings.read_failed");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn metadata_failure_is_not_treated_as_a_missing_settings_file() {
        let invalid_config_dir = PathBuf::from("lumamark-settings-invalid\0metadata");

        let error = load_settings(&invalid_config_dir)
            .expect_err("invalid metadata lookup must not silently return defaults");

        assert_eq!(error.code, "settings.read_failed");
    }

    #[test]
    fn write_io_failure_has_a_settings_specific_code() {
        let parent = unique_test_dir("write-error");
        let config_path = parent.join("config-is-a-file");
        fs::write(&config_path, b"not a directory").expect("write blocking file");

        let error = save_settings(&config_path, &default_settings())
            .expect_err("file cannot be used as config directory");

        assert_eq!(error.code, "settings.write_failed");
        fs::remove_dir_all(parent).expect("cleanup");
    }

    #[test]
    fn acceptance_write_barrier_keeps_the_old_file_until_release() {
        let root = unique_test_dir("acceptance-write-barrier");
        let config_dir = root.join("settings-config");
        let barrier_dir = root.join("settings-write-barrier");
        fs::create_dir_all(&barrier_dir).expect("create barrier dir");
        let mut baseline = default_settings();
        baseline.appearance.theme = "light".to_string();
        save_settings(&config_dir, &baseline).expect("save baseline");
        fs::write(barrier_dir.join("arm"), b"armed").expect("arm barrier");

        let config_for_thread = config_dir.clone();
        let barrier_for_thread = barrier_dir.clone();
        let mut changed = baseline.clone();
        changed.appearance.theme = "system".to_string();
        let save_thread = std::thread::spawn(move || {
            save_settings_with_acceptance_write_barrier(
                &config_for_thread,
                &changed,
                Some(&barrier_for_thread),
            )
        });

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !barrier_dir.join("entered").exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(
            barrier_dir.join("entered").is_file(),
            "save should enter barrier"
        );
        let still_baseline = load_settings(&config_dir).expect("read blocked baseline");
        assert_eq!(still_baseline.settings.appearance.theme, "light");

        assert!(mark_acceptance_settings_close_entered(Some(&barrier_dir))
            .expect("close-entered signal should be created"));
        assert!(barrier_dir.join("close-entered").is_file());
        fs::write(barrier_dir.join("release"), b"release").expect("release barrier");
        save_thread
            .join()
            .expect("save thread should not panic")
            .expect("save should complete after release");
        let persisted = load_settings(&config_dir).expect("read released settings");
        assert_eq!(persisted.settings.appearance.theme, "system");
        assert!(!barrier_dir.join("arm").exists());
        assert!(!barrier_dir.join("entered").exists());
        assert!(!barrier_dir.join("close-entered").exists());
        assert!(!barrier_dir.join("release").exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn acceptance_write_barrier_rejects_a_stale_release_without_overwriting() {
        let root = unique_test_dir("acceptance-write-barrier-stale-release");
        let config_dir = root.join("settings-config");
        let barrier_dir = root.join("settings-write-barrier");
        fs::create_dir_all(&barrier_dir).expect("create barrier dir");
        let baseline = default_settings();
        save_settings(&config_dir, &baseline).expect("save baseline");
        fs::write(barrier_dir.join("arm"), b"armed").expect("arm barrier");
        fs::write(barrier_dir.join("release"), b"stale").expect("stale release");
        let mut changed = baseline.clone();
        changed.appearance.theme = "system".to_string();

        let error =
            save_settings_with_acceptance_write_barrier(&config_dir, &changed, Some(&barrier_dir))
                .expect_err("stale release must fail closed");

        assert_eq!(error.code, "settings.acceptance_write_barrier_failed");
        let persisted = load_settings(&config_dir).expect("read baseline");
        assert_eq!(persisted.settings.appearance.theme, "light");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn acceptance_write_barrier_times_out_without_overwriting() {
        let root = unique_test_dir("acceptance-write-barrier-timeout");
        let config_dir = root.join("settings-config");
        let barrier_dir = root.join("settings-write-barrier");
        fs::create_dir_all(&barrier_dir).expect("create barrier dir");
        let baseline = default_settings();
        save_settings(&config_dir, &baseline).expect("save baseline");
        fs::write(barrier_dir.join("arm"), b"armed").expect("arm barrier");
        let mut changed = baseline.clone();
        changed.appearance.theme = "system".to_string();

        let error = save_settings_with_acceptance_write_barrier_timeout(
            &config_dir,
            &changed,
            Some(&barrier_dir),
            Duration::from_millis(25),
        )
        .expect_err("an unreleased barrier must time out");

        assert_eq!(error.code, "settings.acceptance_write_barrier_failed");
        let persisted = load_settings(&config_dir).expect("read baseline");
        assert_eq!(persisted.settings.appearance.theme, "light");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn acceptance_close_entered_signal_requires_an_entered_write_barrier() {
        assert!(!mark_acceptance_settings_close_entered(None)
            .expect("normal mode should not create a close marker"));
        let root = unique_test_dir("acceptance-close-entered-before-write");
        let barrier_dir = root.join("settings-write-barrier");
        fs::create_dir_all(&barrier_dir).expect("create barrier dir");
        fs::write(barrier_dir.join("arm"), b"armed").expect("arm barrier");

        let error = mark_acceptance_settings_close_entered(Some(&barrier_dir))
            .expect_err("close-entered cannot precede the blocked settings write");

        assert_eq!(error.code, "settings.acceptance_write_barrier_failed");
        assert!(!barrier_dir.join("close-entered").exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn acceptance_write_barrier_rejects_release_without_close_entered() {
        let root = unique_test_dir("acceptance-release-before-close-entered");
        let config_dir = root.join("settings-config");
        let barrier_dir = root.join("settings-write-barrier");
        fs::create_dir_all(&barrier_dir).expect("create barrier dir");
        let baseline = default_settings();
        save_settings(&config_dir, &baseline).expect("save baseline");
        fs::write(barrier_dir.join("arm"), b"armed").expect("arm barrier");
        let mut changed = baseline.clone();
        changed.appearance.theme = "system".to_string();
        let config_for_thread = config_dir.clone();
        let barrier_for_thread = barrier_dir.clone();
        let save_thread = std::thread::spawn(move || {
            save_settings_with_acceptance_write_barrier(
                &config_for_thread,
                &changed,
                Some(&barrier_for_thread),
            )
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !barrier_dir.join("entered").exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(barrier_dir.join("entered").is_file());

        fs::write(barrier_dir.join("release"), b"release").expect("release early");
        let error = save_thread
            .join()
            .expect("save thread should not panic")
            .expect_err("release without close-entered must fail closed");

        assert_eq!(error.code, "settings.acceptance_write_barrier_failed");
        let persisted = load_settings(&config_dir).expect("read baseline");
        assert_eq!(persisted.settings.appearance.theme, "light");
        fs::remove_dir_all(root).expect("cleanup");
    }
}
