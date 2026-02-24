import { describe, it, expect, vi } from 'vitest';

import { IpcDeps } from './IpcWatcher.js';
import { SessionManager } from '../sessions/SessionManager.js';
import { TaskManager } from '../scheduling/TaskService.js';
import { IpcCommandDispatcher } from './IpcDispatcher.js';
import { IpcCommandHandler } from './types.js';

function makeMockDeps(): IpcDeps {
  return {
    sendMessage: async () => {},
    registeredGroups: () => ({}),
    registerGroup: () => {},
    syncGroupMetadata: async () => {},
    getAvailableGroups: () => [],
    writeGroupsSnapshot: () => {},
    sessionManager: {} as SessionManager,
    closeStdin: () => {},
    taskManager: {} as TaskManager,
  };
}

function makeMockHandler(command: string): IpcCommandHandler & { handle: ReturnType<typeof vi.fn> } {
  return {
    command,
    handle: vi.fn(async () => {}),
  };
}

describe('IpcCommandDispatcher', () => {
  it('routes to the correct handler by type', async () => {
    const handlerA = makeMockHandler('type_a');
    const handlerB = makeMockHandler('type_b');
    const dispatcher = new IpcCommandDispatcher([handlerA, handlerB]);
    const deps = makeMockDeps();

    await dispatcher.dispatch({ type: 'type_a' }, 'main', true, deps);

    expect(handlerA.handle).toHaveBeenCalledOnce();
    expect(handlerA.handle).toHaveBeenCalledWith({ type: 'type_a' }, 'main', true, deps);
    expect(handlerB.handle).not.toHaveBeenCalled();
  });

  it('routes to handler B when type matches', async () => {
    const handlerA = makeMockHandler('type_a');
    const handlerB = makeMockHandler('type_b');
    const dispatcher = new IpcCommandDispatcher([handlerA, handlerB]);
    const deps = makeMockDeps();

    await dispatcher.dispatch({ type: 'type_b' }, 'other', false, deps);

    expect(handlerB.handle).toHaveBeenCalledOnce();
    expect(handlerA.handle).not.toHaveBeenCalled();
  });

  it('logs warning for unknown type and does not throw', async () => {
    const handler = makeMockHandler('known');
    const dispatcher = new IpcCommandDispatcher([handler]);
    const deps = makeMockDeps();

    // Should not throw
    await dispatcher.dispatch({ type: 'unknown_type' }, 'main', true, deps);

    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('passes all arguments through to handler', async () => {
    const handler = makeMockHandler('test');
    const dispatcher = new IpcCommandDispatcher([handler]);
    const deps = makeMockDeps();
    const data = { type: 'test', extra: 'value', nested: { a: 1 } };

    await dispatcher.dispatch(data, 'some-group', false, deps);

    expect(handler.handle).toHaveBeenCalledWith(data, 'some-group', false, deps);
  });

  it('handles empty handler list gracefully', async () => {
    const dispatcher = new IpcCommandDispatcher([]);
    const deps = makeMockDeps();

    // Should not throw
    await dispatcher.dispatch({ type: 'anything' }, 'main', true, deps);
  });
});
