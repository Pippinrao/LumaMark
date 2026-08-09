import { invokeCommand } from '../tauri/invokeCommand';

export async function appendDebugLogLine(line: string): Promise<boolean> {
  const result = await invokeCommand<boolean>('debug_append_log', { line });
  return result.ok ? result.data : false;
}
