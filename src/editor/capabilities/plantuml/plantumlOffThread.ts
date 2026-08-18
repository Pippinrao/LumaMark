type SchedulerLike = {
  postTask: (
    callback: () => void,
    options?: { priority?: string },
  ) => Promise<unknown>;
};

export function yieldPlantumlRenderTurn(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (typeof scheduler?.postTask === 'function') {
    return Promise.resolve(scheduler.postTask(() => undefined, {
      priority: 'background',
    })).then(() => undefined);
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}
