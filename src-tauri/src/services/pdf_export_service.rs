use crate::errors::AppError;

pub const PDF_PAGE_WIDTH_INCHES: f64 = 8.27;
pub const PDF_PAGE_HEIGHT_INCHES: f64 = 11.69;
pub const PDF_MARGIN_INCHES: f64 = 0.0;
pub const PDF_TIMEOUT_MS: u64 = 120_000;

pub struct PdfPrintOptions {
    pub replace_existing: bool,
}

impl Default for PdfPrintOptions {
    fn default() -> Self {
        Self {
            replace_existing: false,
        }
    }
}

#[cfg(windows)]
pub fn print_webview_to_pdf(
    window: &tauri::WebviewWindow,
    output_path: &str,
    options: PdfPrintOptions,
) -> Result<u64, AppError> {
    windows_impl::print_webview_to_pdf(window, output_path, options)
}

#[cfg(not(windows))]
pub fn print_webview_to_pdf(
    _window: &tauri::WebviewWindow,
    _output_path: &str,
    _options: PdfPrintOptions,
) -> Result<u64, AppError> {
    Err(AppError::new(
        "export.pdf_unavailable",
        "Direct PDF export is only available on Windows.",
        true,
    ))
}

#[cfg(windows)]
mod windows_impl {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::mpsc;
    use std::time::Duration;

    use tauri::WebviewWindow;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings, ICoreWebView2_7,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, PCWSTR};

    use super::{
        PdfPrintOptions, PDF_MARGIN_INCHES, PDF_PAGE_HEIGHT_INCHES, PDF_PAGE_WIDTH_INCHES,
        PDF_TIMEOUT_MS,
    };
    use crate::errors::AppError;
    use crate::services::export_service::validate_output_path;

    pub fn print_webview_to_pdf(
        window: &WebviewWindow,
        output_path: &str,
        options: PdfPrintOptions,
    ) -> Result<u64, AppError> {
        let output = validate_output_path(output_path, "pdf")?;
        if output.exists() && !options.replace_existing {
            return Err(AppError::new(
                "export.output_exists",
                "The output file already exists.",
                true,
            ));
        }

        let parent = output.parent().ok_or_else(AppError::invalid_path)?;
        let stem = output
            .file_stem()
            .and_then(OsStr::to_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(AppError::invalid_path)?;
        let temp = parent.join(format!(".{stem}.lumamark-{}.pdf", uuid::Uuid::new_v4()));
        let wide_path: Vec<u16> = temp
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_path_for_closure = wide_path.clone();

        let (sender, receiver) = mpsc::channel::<Result<(), String>>();
        window
            .with_webview(move |webview| {
                let result = unsafe {
                    start_print_to_pdf(&webview, &wide_path_for_closure, sender.clone())
                };
                if let Err(error) = result {
                    let _ = sender.send(Err(error));
                }
            })
            .map_err(|error| {
                let _ = std::fs::remove_file(&temp);
                AppError::new(
                    "export.pdf_failed",
                    format!("Could not dispatch the PDF print: {error}"),
                    true,
                )
            })?;

        let result = receiver.recv_timeout(Duration::from_millis(PDF_TIMEOUT_MS));
        let outcome = match result {
            Ok(outcome) => outcome,
            Err(_) => {
                let _ = std::fs::remove_file(&temp);
                return Err(AppError::new(
                    "export.pdf_timeout",
                    "PDF export timed out.",
                    true,
                ));
            }
        };

        if let Err(message) = outcome {
            let _ = std::fs::remove_file(&temp);
            return Err(AppError::new("export.pdf_failed", message, true));
        }

        let byte_length = std::fs::metadata(&temp)
            .map_err(|_| {
                AppError::new(
                    "export.pdf_failed",
                    "The PDF file was not written.",
                    true,
                )
            })?
            .len();
        let mut header = [0_u8; 5];
        std::fs::File::open(&temp)
            .and_then(|mut file| std::io::Read::read_exact(&mut file, &mut header))
            .map_err(|_| {
                let _ = std::fs::remove_file(&temp);
                AppError::new(
                    "export.pdf_failed",
                    "The generated file could not be read as a PDF.",
                    true,
                )
            })?;
        if &header != b"%PDF-" {
            let _ = std::fs::remove_file(&temp);
            return Err(AppError::new(
                "export.pdf_failed",
                "The generated file is not a PDF.",
                true,
            ));
        }

        if output.exists() {
            if options.replace_existing {
                std::fs::remove_file(&output).map_err(|error| {
                    let _ = std::fs::remove_file(&temp);
                    AppError::new(
                        "export.pdf_failed",
                        format!("Could not replace the existing PDF: {error}"),
                        true,
                    )
                })?;
            }
        }
        std::fs::rename(&temp, &output).map_err(|error| {
            let _ = std::fs::remove_file(&temp);
            AppError::new(
                "export.pdf_failed",
                format!("Could not finalize the PDF file: {error}"),
                true,
            )
        })?;

        Ok(byte_length)
    }

    unsafe fn start_print_to_pdf(
        webview: &tauri::webview::PlatformWebview,
        wide_path: &[u16],
        sender: mpsc::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let controller = webview.controller();
        let core = unsafe { controller.CoreWebView2() }
            .map_err(|error| format!("WebView2 controller unavailable: {error}"))?;
        let core7: ICoreWebView2_7 = core
            .cast()
            .map_err(|error| format!("WebView2 PrintToPdf is unavailable: {error}"))?;
        let environment = webview.environment();
        let environment6: ICoreWebView2Environment6 = environment
            .cast()
            .map_err(|error| format!("WebView2 print settings are unavailable: {error}"))?;
        let settings: ICoreWebView2PrintSettings = unsafe { environment6.CreatePrintSettings() }
            .map_err(|error| format!("WebView2 print settings could not be created: {error}"))?;

        unsafe {
            settings
                .SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)
                .map_err(|error| format!("print orientation failed: {error}"))?;
            settings
                .SetPageWidth(PDF_PAGE_WIDTH_INCHES)
                .map_err(|error| format!("print page width failed: {error}"))?;
            settings
                .SetPageHeight(PDF_PAGE_HEIGHT_INCHES)
                .map_err(|error| format!("print page height failed: {error}"))?;
            settings
                .SetMarginTop(PDF_MARGIN_INCHES)
                .map_err(|error| format!("print top margin failed: {error}"))?;
            settings
                .SetMarginBottom(PDF_MARGIN_INCHES)
                .map_err(|error| format!("print bottom margin failed: {error}"))?;
            settings
                .SetMarginLeft(PDF_MARGIN_INCHES)
                .map_err(|error| format!("print left margin failed: {error}"))?;
            settings
                .SetMarginRight(PDF_MARGIN_INCHES)
                .map_err(|error| format!("print right margin failed: {error}"))?;
            settings
                .SetScaleFactor(1.0)
                .map_err(|error| format!("print scale failed: {error}"))?;
            settings
                .SetShouldPrintBackgrounds(true)
                .map_err(|error| format!("print background setting failed: {error}"))?;
            settings
                .SetShouldPrintHeaderAndFooter(false)
                .map_err(|error| format!("print header setting failed: {error}"))?;
        }

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |hr, success| {
            let result = if hr.is_ok() && success {
                Ok(())
            } else {
                Err(format!(
                    "WebView2 PrintToPdf failed (hr={hr:?}, success={success})"
                ))
            };
            let _ = sender.send(result);
            Ok(())
        }));

        unsafe {
            core7
                .PrintToPdf(PCWSTR::from_raw(wide_path.as_ptr()), &settings, &handler)
                .map_err(|error| format!("WebView2 PrintToPdf call failed: {error}"))?;
        }
        Ok(())
    }
}
