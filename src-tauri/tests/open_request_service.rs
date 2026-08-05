use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

#[cfg(windows)]
use lumamark_lib::services::open_request_service::OpenRequest;
use lumamark_lib::services::open_request_service::{parse_open_request, OpenRequestQueue};

#[test]
fn parse_open_request_should_preserve_unicode_and_emoji_paths() {
    let args = vec![
        OsString::from("LumaMark.exe"),
        OsString::from("笔记/✨ 灵感.md"),
    ];

    let request = parse_open_request(&args, Path::new("E:/写作"))
        .expect("Unicode paths should be serializable")
        .expect("Markdown path should be selected");

    let expected: PathBuf = Path::new("E:/写作")
        .join("笔记/✨ 灵感.md")
        .components()
        .collect();
    assert_eq!(request.path, expected.to_str().expect("UTF-8 test path"));
}

#[test]
fn parse_open_request_should_ignore_flags_and_non_markdown_arguments() {
    let args = vec![
        OsString::from("LumaMark.exe"),
        OsString::from("--verbose"),
        OsString::from("notes.txt"),
        OsString::from("README.markdown"),
    ];

    let request = parse_open_request(&args, Path::new("E:/writing"))
        .expect("valid paths should parse")
        .expect("Markdown path should be selected");

    assert!(request.path.ends_with("README.markdown"));
}

#[test]
fn parse_open_request_should_accept_only_the_first_markdown_path_per_launch() {
    let args = vec![
        OsString::from("LumaMark.exe"),
        OsString::from("first.md"),
        OsString::from("second.mdown"),
    ];

    let request = parse_open_request(&args, Path::new("E:/writing"))
        .expect("valid paths should parse")
        .expect("Markdown path should be selected");

    assert!(request.path.ends_with("first.md"));
}

#[test]
fn open_request_queue_should_deduplicate_lexically_equivalent_pending_paths() {
    let queue = OpenRequestQueue::default();
    queue
        .enqueue_os_args(
            &[
                OsString::from("LumaMark.exe"),
                OsString::from("notes/../readme.md"),
            ],
            Path::new("E:/writing"),
        )
        .expect("first request should be queued");
    queue
        .enqueue_os_args(
            &[OsString::from("LumaMark.exe"), OsString::from("readme.md")],
            Path::new("E:/writing"),
        )
        .expect("duplicate request should be handled");

    let drained = queue.drain().expect("open requests should be drained");

    assert_eq!(drained.len(), 1);
    assert!(drained[0].path.ends_with("readme.md"));
}

#[cfg(windows)]
#[test]
fn open_request_queue_should_deduplicate_windows_paths_without_changing_display_path() {
    let queue = OpenRequestQueue::default();
    queue
        .enqueue_os_args(
            &[
                OsString::from("LumaMark.exe"),
                OsString::from(r"E:\Notes\README.md"),
            ],
            Path::new(r"E:\"),
        )
        .expect("first request should be queued");
    queue
        .enqueue_os_args(
            &[
                OsString::from("LumaMark.exe"),
                OsString::from(r"e:\notes\readme.md"),
            ],
            Path::new(r"E:\"),
        )
        .expect("case-only duplicate should be handled");

    let drained = queue.drain().expect("open requests should be drained");

    assert_eq!(
        drained,
        vec![OpenRequest {
            path: r"E:\Notes\README.md".to_owned(),
        }]
    );
}

#[cfg(not(windows))]
#[test]
fn open_request_queue_should_keep_case_distinct_paths_on_case_sensitive_platforms() {
    let queue = OpenRequestQueue::default();
    queue
        .enqueue_os_args(
            &[
                OsString::from("lumamark"),
                OsString::from("Notes/README.md"),
            ],
            Path::new("/writing"),
        )
        .expect("first request should be queued");
    queue
        .enqueue_os_args(
            &[
                OsString::from("lumamark"),
                OsString::from("notes/readme.md"),
            ],
            Path::new("/writing"),
        )
        .expect("case-distinct request should be queued");

    let drained = queue.drain().expect("open requests should be drained");

    assert_eq!(drained.len(), 2);
}

#[cfg(unix)]
#[test]
fn parse_open_request_should_reject_a_non_utf8_path_without_lossy_conversion() {
    use std::os::unix::ffi::OsStringExt;

    let args = vec![
        OsString::from("lumamark"),
        OsString::from_vec(b"invalid-\xFF.md".to_vec()),
    ];

    let error = parse_open_request(&args, Path::new("/tmp"))
        .expect_err("non-UTF-8 paths cannot cross the JSON IPC boundary");

    assert_eq!(error.code, "desktop.open_request_path_not_utf8");

    let queue = OpenRequestQueue::default();
    queue
        .enqueue_os_args(&args, Path::new("/tmp"))
        .expect_err("the queue should retain the serialization failure");
    let drained_error = queue
        .drain()
        .expect_err("the frontend drain should receive the retained failure");
    assert_eq!(drained_error.code, "desktop.open_request_path_not_utf8");
}
