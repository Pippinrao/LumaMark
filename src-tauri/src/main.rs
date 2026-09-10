#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if let lumamark_lib::automation::Detection::Automation(request) =
        lumamark_lib::automation::detect(&args)
    {
        // The automation host owns the process: help/version/mcp-config exit
        // immediately, rendering runs a hidden WebView window.
        lumamark_lib::automation::run(request);
    }

    lumamark_lib::run();
}
