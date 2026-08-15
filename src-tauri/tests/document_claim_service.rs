#[path = "../src/services/document_path_identity.rs"]
mod document_path_identity;

#[path = "../src/services/document_claim_service.rs"]
mod document_claim_service;

#[test]
fn claim_tokens_do_not_expose_a_hash_boundary() {
    use document_claim_service::ClaimToken;

    trait AmbiguousIfHash<Marker> {
        fn marker() {}
    }

    impl<T: ?Sized> AmbiguousIfHash<()> for T {}
    impl<T: ?Sized + std::hash::Hash> AmbiguousIfHash<u8> for T {}

    let _ = <ClaimToken as AmbiguousIfHash<_>>::marker;
}

#[test]
fn claim_token_debug_output_is_redacted() {
    use document_claim_service::{ClaimOperation, DocumentClaimService, ReserveOutcome};

    let service = DocumentClaimService::new().expect("test service should initialize");
    let token = match service
        .reserve(
            "window-a",
            ClaimOperation::new("session-a", 1),
            r"C:\Notes\debug-boundary.md",
        )
        .expect("test path should reserve")
    {
        ReserveOutcome::Reserved { token } => token,
        unexpected => panic!("expected reservation, got {unexpected:?}"),
    };

    assert_eq!(format!("{token:?}"), "ClaimToken(\"[opaque]\")");
}

#[test]
fn claimed_io_boundary_uses_the_registered_operation_path() {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use document_claim_service::{ClaimOperation, DocumentClaimService, ReserveOutcome};

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should follow the Unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("lumamark-claim-io-{nonce}"));
    let document = directory.join("note.md");
    fs::create_dir_all(&directory).expect("test directory should be created");
    fs::write(&document, "claimed-content").expect("test document should be written");
    let display_path = document.to_str().expect("test path should be Unicode");
    let service = DocumentClaimService::new().expect("test service should initialize");
    assert!(matches!(
        service
            .reserve(
                "window-a",
                ClaimOperation::new("session-a", 1),
                display_path,
            )
            .expect("test document should reserve"),
        ReserveOutcome::Reserved { .. }
    ));

    let content = service
        .with_validated_operation_io("window-a", "session-a", 1, display_path, |target| {
            fs::read_to_string(target)
        })
        .expect("claim tuple and path should remain valid")
        .expect("canonical target should remain readable");

    assert_eq!(content, "claimed-content");
    fs::remove_dir_all(directory).expect("test directory should be removed");
}
