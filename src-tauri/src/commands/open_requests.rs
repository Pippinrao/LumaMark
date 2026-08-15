use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{
    errors::AppError,
    services::open_request_service::{
        OpenRequestDelivery, OpenRequestRecovery, OpenRequestService,
    },
};

pub(crate) fn recover_for_window(
    service: &OpenRequestService,
    window_label: &str,
) -> Result<Vec<OpenRequestRecovery>, AppError> {
    service.recover_for_window(window_label)
}

pub(crate) fn claim_for_window(
    service: &OpenRequestService,
    window_label: &str,
) -> Result<Vec<OpenRequestDelivery>, AppError> {
    service.claim_for_window(window_label)
}

pub(crate) fn record_applied_for_window(
    service: &OpenRequestService,
    window_label: &str,
    request_id: &str,
    attempt_token: &str,
) -> Result<(), AppError> {
    service.record_applied(window_label, request_id, attempt_token)
}

pub(crate) fn acknowledge_for_window(
    service: &OpenRequestService,
    window_label: &str,
    request_id: &str,
    attempt_token: &str,
) -> Result<(), AppError> {
    service.acknowledge(window_label, request_id, attempt_token)
}

pub(crate) fn abandon_for_window(
    service: &OpenRequestService,
    window_label: &str,
    request_id: &str,
    attempt_token: &str,
) -> Result<(), AppError> {
    service.abandon(window_label, request_id, attempt_token)
}

async fn run_open_request_command<T, F>(app: AppHandle, command: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&OpenRequestService) -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.try_state::<OpenRequestService>().ok_or_else(|| {
            AppError::new(
                "desktop.open_request_state_unavailable",
                "Desktop open request state is unavailable.",
                false,
            )
        })?;
        command(service.inner())
    })
    .await
    .map_err(|_| {
        AppError::new(
            "desktop.open_request_task_failed",
            "Desktop open request operation failed.",
            true,
        )
    })?
}

#[tauri::command]
pub async fn open_requests_recover(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<OpenRequestRecovery>, AppError> {
    let window_label = window.label().to_owned();
    run_open_request_command(app, move |service| {
        recover_for_window(service, &window_label)
    })
    .await
}

#[tauri::command]
pub async fn open_requests_claim(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<OpenRequestDelivery>, AppError> {
    let window_label = window.label().to_owned();
    run_open_request_command(app, move |service| claim_for_window(service, &window_label)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_requests_record_applied(
    app: AppHandle,
    window: WebviewWindow,
    request_id: String,
    attempt_token: String,
) -> Result<(), AppError> {
    let window_label = window.label().to_owned();
    run_open_request_command(app, move |service| {
        record_applied_for_window(service, &window_label, &request_id, &attempt_token)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_requests_acknowledge(
    app: AppHandle,
    window: WebviewWindow,
    request_id: String,
    attempt_token: String,
) -> Result<(), AppError> {
    let window_label = window.label().to_owned();
    run_open_request_command(app, move |service| {
        acknowledge_for_window(service, &window_label, &request_id, &attempt_token)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_requests_abandon(
    app: AppHandle,
    window: WebviewWindow,
    request_id: String,
    attempt_token: String,
) -> Result<(), AppError> {
    let window_label = window.label().to_owned();
    run_open_request_command(app, move |service| {
        abandon_for_window(service, &window_label, &request_id, &attempt_token)
    })
    .await
}
