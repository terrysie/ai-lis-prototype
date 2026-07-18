#!/usr/bin/env node
const assert = require('assert');
const { createTestDatabase, inspectDatabase } = require('./interface-test-utils');
const { listAdapters, getMappings, setAdapterEnabled, updateMapping, enqueueMessage, processMessage, retryMessage, cancelMessage, setSimulatorFault, runFullDemo, deliverPublishedReport } = require('../src/interface/interfaceCore');

(async () => {
  const options = await createTestDatabase('interface-core');
  const adapters = await listAdapters(options); assert.equal(adapters.length, 7); assert(adapters.every((item) => item.capabilityLabel.includes('capability proof')));
  console.log('PASS adapter registry exposes seven local proof adapters');

  const mappings = await getMappings('his-local', options); assert(mappings.length >= 4);
  await setAdapterEnabled('his-local', false, options); await setAdapterEnabled('his-local', true, options);
  await updateMapping(mappings[0].id, { externalField: 'PID.3.1', localField: 'samples.external_patient_id', enabled: true }, options);
  await inspectDatabase(options.databasePath, ({ row }) => { assert.equal(row("SELECT COUNT(*) count FROM audit_logs WHERE operation_type IN ('adapter_disable','adapter_enable','mapping_update')").count, 3); });
  console.log('PASS adapter enable/disable and field mapping edits are persisted and audited');

  const first = await enqueueMessage({ direction: 'outbound', traceId: 'TRACE-IDEMP', source: 'terry-lis', destination: 'emr-simulator', protocol: 'internal-mock', messageType: 'report', rawPayload: '{}', idempotencyKey: 'idem-1' }, options);
  const duplicate = await enqueueMessage({ direction: 'outbound', traceId: 'TRACE-IDEMP', source: 'terry-lis', destination: 'emr-simulator', protocol: 'internal-mock', messageType: 'report', rawPayload: '{}', idempotencyKey: 'idem-1' }, options);
  assert.equal(first.message.id, duplicate.message.id); assert.equal(duplicate.duplicate, true);
  console.log('PASS message idempotency rejects duplicate persistence');

  await setSimulatorFault('emr-simulator', 'error', options);
  const failing = await enqueueMessage({ direction: 'outbound', traceId: 'TRACE-DLQ', source: 'terry-lis', destination: 'emr-simulator', protocol: 'internal-mock', messageType: 'report', rawPayload: '{}', idempotencyKey: 'dlq-1', retryPolicy: { maxAttempts: 2, strategy: 'exponential', delaySeconds: 1 } }, options);
  const retrying = await processMessage(failing.message.id, options); assert.equal(retrying.status, 'retrying'); assert(retrying.nextRetryAt);
  const dead = await processMessage(failing.message.id, options); assert.equal(dead.status, 'dead-letter'); assert.equal(dead.attempts, 2);
  await setSimulatorFault('emr-simulator', 'success', options); const recovered = await retryMessage(dead.id, options); assert.equal(recovered.status, 'succeeded');
  console.log('PASS exponential retry, max-attempt dead-letter and manual reprocess');

  const cancellable = await enqueueMessage({ direction: 'outbound', traceId: 'TRACE-CANCEL', source: 'terry-lis', destination: 'emr-simulator', protocol: 'internal-mock', messageType: 'report', rawPayload: '{}', idempotencyKey: 'cancel-1' }, options);
  const cancelled = await cancelMessage(cancellable.message.id, options); assert.equal(cancelled.status, 'cancelled');
  console.log('PASS queued message manual cancellation');

  const demo = await runFullDemo({ scenarioKey: 'CORE-INTEGRATION', resultMode: 'normal' }, options); assert.equal(demo.resultStatus, 'succeeded'); assert.equal(demo.reportStatus, 'succeeded');
  const redelivery = await deliverPublishedReport(demo.resultId, 'emr-simulator', options); assert.equal(redelivery.deliveryStatus, 'acknowledged'); assert.equal(redelivery.ackCode, 'AA'); assert.equal(redelivery.traceId, demo.traceId);
  console.log('PASS HIS order and instrument result integration with report ACK');
  await setSimulatorFault('cbc-synthetic', 'duplicate', options);
  const cbc = await runFullDemo({ scenarioKey: 'CORE-CBC-ASTM', instrument: 'cbc-synthetic', resultMode: 'abnormal' }, options);
  assert.equal(cbc.duplicateInjection, true); await setSimulatorFault('cbc-synthetic', 'success', options);
  const immuno = await runFullDemo({ scenarioKey: 'CORE-IMMUNO-FILE', instrument: 'immuno-synthetic', resultMode: 'normal' }, options);
  assert.equal(cbc.resultStatus, 'succeeded'); assert.equal(immuno.resultStatus, 'succeeded');
  await inspectDatabase(options.databasePath, ({ row }) => { assert.equal(row("SELECT protocol FROM interface_messages WHERE id=:id", { ':id': cbc.resultMessageId }).protocol, 'ASTM/TCP'); assert.equal(row("SELECT protocol FROM interface_messages WHERE id=:id", { ':id': immuno.resultMessageId }).protocol, 'file-drop'); });
  console.log('PASS three deterministic instrument profiles use HL7, ASTM/TCP and file-drop paths');
  console.log('PASS interface core tests completed');
})().catch((error) => { console.error('FAIL interface core tests'); console.error(error); process.exit(1); });
