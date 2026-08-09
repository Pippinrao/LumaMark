use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::errors::AppError;

pub const DEFAULT_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const DEFAULT_MAX_LINES_PER_SECOND: u32 = 40;
pub const DEBUG_LOG_FILE_NAME: &str = "debug.log";
pub const DEBUG_LOG_ROTATED_NAME: &str = "debug.log.1";

#[derive(Debug)]
pub struct DebugLogLimiter {
    max_lines_per_second: u32,
    window_started_at: Instant,
    lines_in_window: u32,
}

impl DebugLogLimiter {
    pub fn new(max_lines_per_second: u32) -> Self {
        Self {
            max_lines_per_second: max_lines_per_second.max(1),
            window_started_at: Instant::now(),
            lines_in_window: 0,
        }
    }

    pub fn allow(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.window_started_at) >= Duration::from_secs(1) {
            self.window_started_at = now;
            self.lines_in_window = 0;
        }

        if self.lines_in_window >= self.max_lines_per_second {
            return false;
        }

        self.lines_in_window += 1;
        true
    }
}

#[derive(Debug)]
pub struct DebugLogService {
    limiter: Mutex<DebugLogLimiter>,
    max_file_bytes: u64,
}

impl Default for DebugLogService {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_LINES_PER_SECOND)
    }
}

impl DebugLogService {
    pub fn new(max_file_bytes: u64, max_lines_per_second: u32) -> Self {
        Self {
            limiter: Mutex::new(DebugLogLimiter::new(max_lines_per_second)),
            max_file_bytes: max_file_bytes.max(1),
        }
    }

    /// Returns Ok(true) when the line was written, Ok(false) when rate-limited.
    pub fn append_line(&self, log_directory: &Path, line: &str) -> Result<bool, AppError> {
        let allowed = self
            .limiter
            .lock()
            .map_err(|_| AppError::new("debug.log_lock", "Debug log lock was poisoned.", true))?
            .allow();

        if !allowed {
            return Ok(false);
        }

        fs::create_dir_all(log_directory)?;
        let log_path = log_directory.join(DEBUG_LOG_FILE_NAME);
        rotate_if_needed(&log_path, log_directory, self.max_file_bytes)?;

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        writeln!(file, "{line}")?;
        Ok(true)
    }
}

fn rotate_if_needed(
    log_path: &Path,
    log_directory: &Path,
    max_file_bytes: u64,
) -> Result<(), AppError> {
    let metadata = match fs::metadata(log_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    if metadata.len() < max_file_bytes {
        return Ok(());
    }

    let rotated = log_directory.join(DEBUG_LOG_ROTATED_NAME);
    let _ = fs::remove_file(&rotated);
    fs::rename(log_path, &rotated)?;
    Ok(())
}

pub fn debug_log_directory(app_data_directory: &Path) -> PathBuf {
    app_data_directory.join("logs")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn temp_directory(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-debug-log-{name}-{nanos}"));
        fs::create_dir_all(&directory).expect("create temp dir");
        directory
    }

    #[test]
    fn append_line_writes_when_directory_is_ready() {
        let directory = temp_directory("append");
        let service = DebugLogService::new(1_024, 100);

        assert_eq!(
            service.append_line(&directory, "hello").expect("append"),
            true
        );

        let text = fs::read_to_string(directory.join(DEBUG_LOG_FILE_NAME)).expect("read");
        assert_eq!(text, "hello\n");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rate_limit_drops_excess_lines_in_the_same_second() {
        let directory = temp_directory("rate");
        let service = DebugLogService::new(1_024, 2);

        assert_eq!(service.append_line(&directory, "a").unwrap(), true);
        assert_eq!(service.append_line(&directory, "b").unwrap(), true);
        assert_eq!(service.append_line(&directory, "c").unwrap(), false);

        let text = fs::read_to_string(directory.join(DEBUG_LOG_FILE_NAME)).expect("read");
        assert_eq!(text, "a\nb\n");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rotates_when_file_exceeds_max_bytes() {
        let directory = temp_directory("rotate");
        let service = DebugLogService::new(20, 100);

        assert_eq!(
            service
                .append_line(&directory, "012345678901234567890123456789")
                .unwrap(),
            true
        );
        assert_eq!(service.append_line(&directory, "next").unwrap(), true);

        assert!(directory.join(DEBUG_LOG_ROTATED_NAME).exists());
        let text = fs::read_to_string(directory.join(DEBUG_LOG_FILE_NAME)).expect("read");
        assert_eq!(text, "next\n");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn limiter_resets_after_one_second_window() {
        let mut limiter = DebugLogLimiter::new(1);
        assert!(limiter.allow());
        assert!(!limiter.allow());
        limiter.window_started_at = Instant::now() - Duration::from_secs(1);
        assert!(limiter.allow());
    }
}
