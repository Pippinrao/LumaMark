import { commandRegistry } from './commandRegistry';
import type {
  CommandActionId,
  CommandHandlerMap,
  CommandHandlerMaps,
  CommandMenuInvocation,
} from './commandTypes';

export function runCommandAction(
  handlers: CommandHandlerMap,
  action: CommandActionId,
): void {
  if (!Object.hasOwn(commandRegistry, action)) {
    throw new Error(`Unknown command action: ${String(action)}`);
  }

  const handler =
    handlers && Object.hasOwn(handlers, action) ? handlers[action] : undefined;
  requireCommandHandler(action, handler)();
}

export function runCommandMenuInvocation(
  handlers: CommandHandlerMaps,
  invocation: CommandMenuInvocation,
): void {
  if (!isRecord(invocation)) {
    throw new Error(`Unknown command invocation: ${JSON.stringify(invocation)}`);
  }

  switch (invocation.kind) {
    case 'action':
      runCommandAction(handlers?.actions, invocation.action);
      return;
    case 'rangeAction':
      runRangeAction(handlers?.actions, invocation);
      return;
    case 'payloadAction':
      runPayloadAction(handlers, invocation);
      return;
    default:
      assertNever(invocation);
  }
}

function runRangeAction(
  handlers: CommandHandlerMap | null | undefined,
  invocation: Extract<CommandMenuInvocation, { kind: 'rangeAction' }>,
): void {
  assertValidRange(invocation.action, invocation.range);

  switch (invocation.action) {
    case 'copyTable':
      requireCommandHandler(invocation.action, handlers?.copyTable)(invocation.range);
      return;
    case 'deleteImageReference':
      requireCommandHandler(invocation.action, handlers?.deleteImageReference)(
        invocation.range,
      );
      return;
    case 'deleteTable':
      requireCommandHandler(invocation.action, handlers?.deleteTable)(invocation.range);
      return;
    default:
      assertNever(invocation.action);
  }
}

function runPayloadAction(
  handlers: CommandHandlerMaps,
  invocation: Extract<CommandMenuInvocation, { kind: 'payloadAction' }>,
): void {
  switch (invocation.action) {
    case 'copyImagePath':
      assertStringPayload(invocation.action, invocation.payload, ['src']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.copyImagePath,
      )(invocation.payload);
      return;
    case 'copyLinkAddress':
      assertStringPayload(invocation.action, invocation.payload, ['href']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.copyLinkAddress,
      )(invocation.payload);
      return;
    case 'fileTreeCopyPath':
      assertStringPayload(invocation.action, invocation.payload, ['path']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.fileTreeCopyPath,
      )(invocation.payload);
      return;
    case 'fileTreeCreateDirectory':
      assertStringPayload(invocation.action, invocation.payload, ['parentPath']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.fileTreeCreateDirectory,
      )(invocation.payload);
      return;
    case 'fileTreeCreateFile':
      assertStringPayload(invocation.action, invocation.payload, ['parentPath']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.fileTreeCreateFile,
      )(invocation.payload);
      return;
    case 'fileTreeDelete':
      assertFileTreeEntryPayload(invocation.action, invocation.payload);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.fileTreeDelete,
      )(invocation.payload);
      return;
    case 'fileTreeRename':
      assertFileTreeEntryPayload(invocation.action, invocation.payload);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.fileTreeRename,
      )(invocation.payload);
      return;
    case 'fileTreeReveal':
      assertStringPayload(invocation.action, invocation.payload, ['path']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.fileTreeReveal,
      )(invocation.payload);
      return;
    case 'openLink':
      assertStringPayload(invocation.action, invocation.payload, ['href']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.openLink,
      )(invocation.payload);
      return;
    case 'openRecentFile':
      assertStringPayload(invocation.action, invocation.payload, ['path']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.openRecentFile,
      )(invocation.payload);
      return;
    case 'revealImage':
      assertStringPayload(invocation.action, invocation.payload, ['src']);
      requireCommandHandler(
        invocation.action,
        handlers?.payloadActions?.revealImage,
      )(invocation.payload);
      return;
    default:
      assertNever(invocation);
  }
}

function assertFileTreeEntryPayload(action: string, payload: unknown): void {
  assertStringPayload(action, payload, ['name', 'path']);
  if (
    !isRecord(payload) ||
    (payload.entryKind !== 'directory' && payload.entryKind !== 'file')
  ) {
    throw new Error(`Invalid command payload: ${action}`);
  }
}

function assertStringPayload(
  action: string,
  payload: unknown,
  fields: readonly string[],
): void {
  if (
    !isRecord(payload) ||
    fields.some((field) => typeof payload[field] !== 'string')
  ) {
    throw new Error(`Invalid command payload: ${action}`);
  }
}

function assertValidRange(action: string, range: unknown): void {
  if (
    !isRecord(range) ||
    typeof range.from !== 'number' ||
    typeof range.to !== 'number'
  ) {
    throw new Error(`Invalid command range: ${action}`);
  }
}

function requireCommandHandler<Handler>(
  action: string,
  handler: Handler | null | undefined,
): Handler {
  if (typeof handler !== 'function') {
    throw new Error(`Missing command handler: ${action}`);
  }

  return handler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertNever(value: never): never {
  throw new Error(`Unknown command invocation: ${JSON.stringify(value)}`);
}
