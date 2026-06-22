import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsDir, '..');
const rollupRoot = path.join(projectRoot, 'node_modules', 'rollup');

const rollupTargets = new Map([
  ['rollup', path.join(rollupRoot, 'dist', 'es', 'rollup.js')],
  ['rollup/parseAst', path.join(rollupRoot, 'dist', 'es', 'parseAst.js')],
  ['rollup/loadConfigFile', path.join(rollupRoot, 'dist', 'loadConfigFile.js')],
  ['rollup/getLogFilter', path.join(rollupRoot, 'dist', 'getLogFilter.js')],
]);

export async function resolve(specifier, context, defaultResolve) {
  const exactTarget = rollupTargets.get(specifier);
  if (exactTarget) {
    return defaultResolve(pathToFileURL(exactTarget).href, context, defaultResolve);
  }

  if (specifier.startsWith('rollup/')) {
    const relativePath = specifier.slice('rollup/'.length);
    const esCandidate = path.join(rollupRoot, 'dist', 'es', `${relativePath}.js`);
    const cjsCandidate = path.join(rollupRoot, 'dist', `${relativePath}.js`);
    const target = relativePath.startsWith('dist/')
      ? path.join(rollupRoot, relativePath)
      : esCandidate;

    try {
      return defaultResolve(pathToFileURL(target).href, context, defaultResolve);
    } catch {
      return defaultResolve(pathToFileURL(cjsCandidate).href, context, defaultResolve);
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}
