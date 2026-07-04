export type RenderJobStatus = 'loading' | 'success' | 'error';

export type RenderJobResult<T> = {
  cacheKey: string;
  value: T;
};
