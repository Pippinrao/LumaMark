use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use lumamark_lib::services::file_watch_service::{FileWatchEvent, FileWatchEventKind};
use lumamark_lib::services::file_watch_session_hub::FileWatchSessionHub;

struct TestFiles {
    root: PathBuf,
    first: PathBuf,
    second: PathBuf,
}

impl TestFiles {
    fn new(name: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lumamark-watch-hub-{name}-{}-{nanos}",
            std::process::id()
        ));
        let first_directory = root.join("first-window");
        let second_directory = root.join("second-window");
        fs::create_dir_all(&first_directory).expect("first fixture directory should be created");
        fs::create_dir_all(&second_directory).expect("second fixture directory should be created");
        let first = first_directory.join("note.md");
        let second = second_directory.join("note.md");
        fs::write(&first, "first-before").expect("first fixture should be written");
        fs::write(&second, "second-before").expect("second fixture should be written");

        Self {
            root,
            first,
            second,
        }
    }
}

impl Drop for TestFiles {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn drain(receiver: &Receiver<(String, FileWatchEvent)>) {
    while receiver.try_recv().is_ok() {}
}

fn receive_document_event(
    receiver: &Receiver<(String, FileWatchEvent)>,
) -> (String, FileWatchEvent) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let event = receiver
            .recv_timeout(remaining)
            .expect("a document change event should arrive");
        if event.1.kind == FileWatchEventKind::Document {
            return event;
        }
    }
}

fn assert_no_document_event_for(
    receiver: &Receiver<(String, FileWatchEvent)>,
    label: &str,
    path: &Path,
) {
    let deadline = Instant::now() + Duration::from_millis(700);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok((observed_label, event)) => {
                assert!(
                    observed_label != label
                        || event.kind != FileWatchEventKind::Document
                        || Path::new(&event.path) != path,
                    "removed window `{label}` emitted a document event for `{}`",
                    path.display()
                );
            }
            Err(mpsc::RecvTimeoutError::Timeout) => return,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                panic!("file watch event channel disconnected unexpectedly")
            }
        }
    }
}

#[test]
fn document_events_should_be_isolated_by_window_label() {
    let files = TestFiles::new("event-isolation");
    let (sender, receiver) = mpsc::channel();
    let hub = FileWatchSessionHub::new(move |label, event| {
        let _ = sender.send((label.to_owned(), event));
    });
    hub.watch_document("window-a", &files.first)
        .expect("first window should watch its document");
    hub.watch_document("window-b", &files.second)
        .expect("second window should watch its document");
    drain(&receiver);

    fs::write(&files.first, "first-after").expect("first fixture should change");
    let (first_label, first_event) = receive_document_event(&receiver);
    assert_eq!(
        (first_label.as_str(), Path::new(&first_event.path)),
        ("window-a", files.first.as_path())
    );

    fs::write(&files.second, "second-after").expect("second fixture should change");
    let (second_label, second_event) = receive_document_event(&receiver);
    assert_eq!(
        (second_label.as_str(), Path::new(&second_event.path)),
        ("window-b", files.second.as_path())
    );
}

#[test]
fn removing_one_window_should_leave_the_other_window_watcher_active() {
    let files = TestFiles::new("cleanup-isolation");
    let (sender, receiver) = mpsc::channel();
    let hub = FileWatchSessionHub::new(move |label, event| {
        let _ = sender.send((label.to_owned(), event));
    });
    hub.watch_document("window-a", &files.first)
        .expect("first window should watch its document");
    hub.watch_document("window-b", &files.second)
        .expect("second window should watch its document");
    hub.remove_session("window-a")
        .expect("first window session should be removed");
    std::thread::sleep(Duration::from_millis(300));
    drain(&receiver);

    fs::write(&files.first, "first-after-removal").expect("first fixture should change");
    fs::write(&files.second, "second-still-live").expect("second fixture should change");
    let (label, event) = receive_document_event(&receiver);

    assert_eq!(
        (label.as_str(), Path::new(&event.path)),
        ("window-b", files.second.as_path())
    );
    assert_no_document_event_for(&receiver, "window-a", &files.first);
}
