import type { EditorEditState } from '../../editor/commands/editorCommandPort';
import {
  getCommandDescriptor,
  type CommandAvailabilityPolicy,
  type CommandDescriptorActionId,
} from './commandRegistry';

export type CommandAvailabilityContext = {
  editorAvailable?: boolean;
  editorState?: EditorEditState;
  fileOpening?: boolean;
  surfaceDisabled?: boolean;
};

export function isCommandActionDisabled(
  action: CommandDescriptorActionId,
  {
    editorAvailable = false,
    editorState,
    fileOpening = false,
    surfaceDisabled = false,
  }: CommandAvailabilityContext,
): boolean {
  const policy = getCommandDescriptor(action).availability;

  if (fileOpening && policy.blockWhileFileOpening) {
    return true;
  }

  switch (policy.scope) {
    case 'always':
      return false;
    case 'editor':
      return editorPolicyDisabled(policy, editorAvailable, editorState);
    case 'surface':
      // Payload actions depend on a validated context target. Their originating
      // surface owns target-specific disabled state and platform failures.
      return surfaceDisabled;
    default:
      return assertNever(policy);
  }
}

function editorPolicyDisabled(
  policy: Extract<CommandAvailabilityPolicy, { scope: 'editor' }>,
  editorAvailable: boolean,
  editorState: EditorEditState | undefined,
): boolean {
  if (!editorAvailable || !editorState) {
    return true;
  }

  if (policy.writable && editorState.readOnly) {
    return true;
  }

  if (policy.requiresSelection && editorState.selectionEmpty) {
    return true;
  }

  if (policy.clipboard === 'read' && !editorState.clipboardReadAvailable) {
    return true;
  }

  return policy.clipboard === 'write' && !editorState.clipboardWriteAvailable;
}

function assertNever(value: never): never {
  throw new Error(`Unknown command availability policy: ${JSON.stringify(value)}`);
}
