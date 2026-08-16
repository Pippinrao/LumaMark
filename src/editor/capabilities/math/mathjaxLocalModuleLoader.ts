import { mathjax } from '@mathjax/src/js/mathjax.js';
import { mathjax as mathjaxMjs } from '@mathjax/src/mjs/mathjax.js';

const NEWCM_MODULE_PREFIXES = [
  '@mathjax/mathjax-newcm-font/js/chtml/dynamic/',
  '@mathjax/mathjax-newcm-font/mjs/chtml/dynamic/',
] as const;

const newcmDynamicModulesPromise = import('./newcmDynamicModules');

function fileNameFromModulePath(modulePath: string): string {
  const normalized = modulePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

async function resolveNewcmDynamicModule(moduleName: string): Promise<unknown> {
  if (
    !NEWCM_MODULE_PREFIXES.some((prefix) => moduleName.startsWith(prefix))
  ) {
    throw new Error(`MathJax dynamic module is not allowed: ${moduleName}`);
  }

  const fileName = fileNameFromModulePath(moduleName);
  const { newcmDynamicModules } = await newcmDynamicModulesPromise;
  const loaded = Object.entries(newcmDynamicModules).find(([modulePath]) => {
    const normalized = modulePath.replaceAll('\\', '/');
    return normalized === fileName || normalized.endsWith(`/${fileName}`);
  })?.[1];

  if (!loaded) {
    throw new Error(`MathJax dynamic module is not bundled: ${moduleName}`);
  }

  return loaded;
}

function installMathjaxLoader(target: {
  asyncIsSynchronous?: boolean;
  asyncLoad?: (name: string) => Promise<unknown>;
}): void {
  target.asyncIsSynchronous = false;
  target.asyncLoad = resolveNewcmDynamicModule;
}

installMathjaxLoader(mathjax);
installMathjaxLoader(mathjaxMjs);
