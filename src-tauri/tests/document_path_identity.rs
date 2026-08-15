#[path = "../src/services/document_path_identity.rs"]
mod document_path_identity;

use document_path_identity::{DocumentPathIdentity, PathIdentityError};

#[cfg(windows)]
#[test]
fn shared_identity_facade_rejects_windows_rooted_paths_without_a_drive() {
    let error = match DocumentPathIdentity::resolve("/workspace/notes/draft.md") {
        Err(error) => error,
        Ok(_) => panic!("a Windows document identity must be fully qualified"),
    };

    assert_eq!(error, PathIdentityError::InvalidPath);
}

#[cfg(unix)]
#[test]
fn shared_identity_facade_treats_double_slash_as_a_posix_alias() {
    let normal = DocumentPathIdentity::lexical("/tmp/lumamark/draft.md")
        .expect("normal POSIX path should parse");
    let double_slash = DocumentPathIdentity::lexical("//tmp/lumamark/draft.md")
        .expect("double-slash POSIX path should parse");

    assert_eq!(normal, double_slash);
}

#[test]
fn shared_identity_facade_normalizes_normal_win32_aliases() {
    let first =
        DocumentPathIdentity::resolve(r"C:\Notes\Draft.md").expect("first path should resolve");
    let alias = DocumentPathIdentity::resolve("c:\\notes\\DRAFT.md. ")
        .expect("normal Win32 alias should resolve");

    assert!(first.lexical_alias() == alias.lexical_alias());
    assert!(first.resolved() == alias.resolved());
    assert!(first.overlaps(&alias));
}

#[test]
fn shared_identity_facade_preserves_verbatim_trailing_suffixes() {
    let first = DocumentPathIdentity::resolve(r"\\?\C:\Notes\Draft.md")
        .expect("first verbatim path should resolve");
    let distinct = DocumentPathIdentity::resolve(r"\\?\C:\Notes\Draft.md.")
        .expect("second verbatim path should resolve");

    assert!(first.lexical_alias() != distinct.lexical_alias());
    assert!(first.resolved() != distinct.resolved());
    assert!(!first.overlaps(&distinct));
}

#[test]
fn shared_identity_facade_exposes_lexical_aliases_without_requiring_io() {
    let first = DocumentPathIdentity::lexical(r"\\Server\Offline\Draft.md")
        .expect("standard UNC path should parse lexically");
    let alias = DocumentPathIdentity::lexical(r"\\?\UNC\server\offline\DRAFT.md")
        .expect("extended UNC alias should parse lexically");

    assert!(first == alias);
}

#[test]
fn shared_identity_facade_normalizes_unc_trailing_suffixes_but_preserves_verbatim_names() {
    let normal = DocumentPathIdentity::lexical(r"\\Server\Share\Draft.md")
        .expect("normal UNC path should parse");
    let normal_alias = DocumentPathIdentity::lexical(r"\\server\share\DRAFT.md. ")
        .expect("normal UNC trailing suffix alias should parse");
    let verbatim = DocumentPathIdentity::lexical(r"\\?\UNC\server\share\draft.md.")
        .expect("verbatim UNC path should parse");

    assert!(normal == normal_alias);
    assert!(normal != verbatim);
}
