import { register } from 'node:module';

// Register the custom loader to redirect rollup imports to local node_modules
register('./resolve-rollup-loader.mjs', import.meta.url);

// Now import vite CLI from local node_modules
import('../node_modules/vite/dist/node/cli.js');
