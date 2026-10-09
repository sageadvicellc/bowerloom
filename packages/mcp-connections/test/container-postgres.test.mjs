import pg from 'pg';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as runtime from '../../../dist/packages/mcp-connections/src/index.js';
import {registerContainerPostgresProof} from '../../../tools/cli-distribution/container-proof-driver.mjs';

registerContainerPostgresProof({runtime,pg,
 moduleUrl:new URL('../../../dist/packages/mcp-connections/src/index.js',import.meta.url).href,
 pgUrl:pathToFileURL(createRequire(import.meta.url).resolve('pg')).href,
 fixturesDir:fileURLToPath(new URL('./fixtures',import.meta.url)),
});
