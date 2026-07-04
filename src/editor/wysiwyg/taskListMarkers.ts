export type TaskListMarker = {
  checked: boolean;
  listMarkerFrom: number;
  listMarkerTo: number;
  taskMarkerFrom: number;
  taskMarkerTo: number;
};

const TASK_LIST_MARKER_PATTERN =
  /^(\s{0,3}(?:[-*+]|\d+[.)])\s+)(\[[ xX]\])(?=\s|$)/;

export function parseTaskListMarker(text: string): TaskListMarker | null {
  const match = text.match(TASK_LIST_MARKER_PATTERN);

  if (!match) {
    return null;
  }

  const taskMarkerFrom = match[1].length;
  const taskMarkerTo = taskMarkerFrom + match[2].length;

  return {
    checked: match[2].toLowerCase() === '[x]',
    listMarkerFrom: 0,
    listMarkerTo: taskMarkerTo,
    taskMarkerFrom,
    taskMarkerTo,
  };
}
