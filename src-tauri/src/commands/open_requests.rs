use tauri::State;

use crate::{
    errors::AppError,
    services::open_request_service::{OpenRequest, OpenRequestQueue},
};

#[tauri::command]
pub fn open_requests_drain(
    queue: State<'_, OpenRequestQueue>,
) -> Result<Vec<OpenRequest>, AppError> {
    queue.drain()
}
