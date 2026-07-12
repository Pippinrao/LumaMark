use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use lumamark_lib::services::asset_service::cache_remote_image;

const PUBLIC_IMAGE_FIXTURES: &[(&str, &str)] = &[
    (
        "https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png",
        "png",
    ),
    (
        "https://upload.wikimedia.org/wikipedia/commons/8/81/Wikimedia-logo.svg",
        "svg",
    ),
];

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(name: &str) -> Self {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("lumamark-{name}-{suffix}"));
        fs::create_dir_all(&path).expect("live test directory should be created");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
#[ignore = "requires public network access"]
fn cache_remote_images_from_public_fixture_urls() {
    let directory = TestDirectory::new("remote-image-live");
    let document_path = directory.path().join("live-assets.md");
    fs::write(&document_path, "# Live remote image fixtures\n")
        .expect("live test document should be written");

    for (url, extension) in PUBLIC_IMAGE_FIXTURES {
        let first = cache_remote_image(&document_path, url)
            .unwrap_or_else(|error| panic!("first download failed for {url}: {error:?}"));
        let cached = cache_remote_image(&document_path, url)
            .unwrap_or_else(|error| panic!("cache lookup failed for {url}: {error:?}"));
        let bytes = fs::read(&first.path)
            .unwrap_or_else(|error| panic!("cached file could not be read for {url}: {error}"));

        assert!(!first.cache_hit, "first request should download {url}");
        assert!(
            cached.cache_hit,
            "second request should hit cache for {url}"
        );
        assert_eq!(first.path, cached.path);
        assert_eq!(first.byte_length, bytes.len());
        assert_eq!(cached.byte_length, bytes.len());
        assert_eq!(
            Path::new(&first.path)
                .extension()
                .and_then(|value| value.to_str()),
            Some(*extension)
        );

        match *extension {
            "png" => assert!(
                bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                "PNG fixture should retain its signature"
            ),
            "svg" => {
                let svg = std::str::from_utf8(&bytes).expect("SVG fixture should be UTF-8");
                assert!(
                    svg.contains("<svg"),
                    "SVG fixture should contain an svg root"
                );
            }
            _ => unreachable!("fixture extension is controlled by the test"),
        }
    }
}
