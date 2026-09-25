import assert from 'node:assert/strict';
import test from 'node:test';

import { getLocalComposeServerUrl } from '../../scripts/local-compose.mjs';

test('local Compose URLs use each service port', (t) => {
  const previousPlantUmlPort = process.env.PLANTUML_HOST_PORT;
  const previousStructurizrPort = process.env.STRUCTURIZR_HOST_PORT;
  t.after(() => {
    if (previousPlantUmlPort === undefined) delete process.env.PLANTUML_HOST_PORT;
    else process.env.PLANTUML_HOST_PORT = previousPlantUmlPort;
    if (previousStructurizrPort === undefined) delete process.env.STRUCTURIZR_HOST_PORT;
    else process.env.STRUCTURIZR_HOST_PORT = previousStructurizrPort;
  });

  process.env.PLANTUML_HOST_PORT = '18081';
  process.env.STRUCTURIZR_HOST_PORT = '19091';
  assert.equal(getLocalComposeServerUrl('plantuml'), 'http://127.0.0.1:18081');
  assert.equal(getLocalComposeServerUrl('structurizr'), 'http://127.0.0.1:19091');
  assert.throws(() => getLocalComposeServerUrl('unknown'), /Unknown local Compose service/);
});
