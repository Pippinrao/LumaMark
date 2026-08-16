import { mathjax } from '@mathjax/src/js/mathjax.js';

const NEWCM_MODULE_PREFIX =
  '@mathjax/mathjax-newcm-font/js/chtml/dynamic/';
const NEWCM_GLOB_PREFIX =
  '../../../../node_modules/@mathjax/mathjax-newcm-font/mjs/chtml/dynamic/';
const newcmDynamicModules = import.meta.glob(
  '../../../../node_modules/@mathjax/mathjax-newcm-font/mjs/chtml/dynamic/*.js',
);

mathjax.asyncIsSynchronous = false;
mathjax.asyncLoad = async (moduleName: string): Promise<unknown> => {
  if (!moduleName.startsWith(NEWCM_MODULE_PREFIX)) {
    throw new Error(`MathJax dynamic module is not allowed: ${moduleName}`);
  }

  const modulePath = `${NEWCM_GLOB_PREFIX}${moduleName.slice(NEWCM_MODULE_PREFIX.length)}`;
  const load = newcmDynamicModules[modulePath];

  if (!load) {
    throw new Error(`MathJax dynamic module is not bundled: ${moduleName}`);
  }

  return load();
};
