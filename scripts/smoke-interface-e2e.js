#!/usr/bin/env node
const assert = require('assert');
const { createTestDatabase, inspectDatabase } = require('./interface-test-utils');
const { runFullDemo, getInterfaceCenterData } = require('../src/interface/interfaceCore');

(async () => {
  const options = await createTestDatabase('interface-e2e');
  const first = await runFullDemo({ scenarioKey: 'E2E-CLOSED-LOOP', resultMode: 'critical', instrument: 'bio-synthetic', destination: 'emr-simulator' }, options);
  assert(first.traceId); assert(first.sampleId); assert(first.orderId); assert(first.resultId); assert.equal(first.resultStatus, 'succeeded'); assert.equal(first.reportStatus, 'succeeded');
  console.log('PASS HIS -> LIS -> instrument -> LIS -> EMR closed loop');

  const before = await inspectDatabase(options.databasePath, ({ row }) => ({ samples: Number(row("SELECT COUNT(*) count FROM samples WHERE interface_trace_id=:trace", { ':trace': first.traceId }).count), orders: Number(row("SELECT COUNT(*) count FROM laboratory_orders WHERE trace_id=:trace", { ':trace': first.traceId }).count), results: Number(row("SELECT COUNT(*) count FROM test_results tr JOIN samples s ON s.id=tr.sample_id WHERE s.interface_trace_id=:trace", { ':trace': first.traceId }).count) }));
  const second = await runFullDemo({ scenarioKey: 'E2E-CLOSED-LOOP', resultMode: 'critical', instrument: 'bio-synthetic', destination: 'emr-simulator' }, options);
  const after = await inspectDatabase(options.databasePath, ({ row }) => ({ samples: Number(row("SELECT COUNT(*) count FROM samples WHERE interface_trace_id=:trace", { ':trace': first.traceId }).count), orders: Number(row("SELECT COUNT(*) count FROM laboratory_orders WHERE trace_id=:trace", { ':trace': first.traceId }).count), results: Number(row("SELECT COUNT(*) count FROM test_results tr JOIN samples s ON s.id=tr.sample_id WHERE s.interface_trace_id=:trace", { ':trace': first.traceId }).count), critical: Number(row('SELECT COUNT(*) count FROM critical_values WHERE result_id=:id', { ':id': first.resultId }).count), deliveries: Number(row('SELECT COUNT(*) count FROM external_report_deliveries WHERE result_id=:id', { ':id': first.resultId }).count), published: row('SELECT result_status FROM test_results WHERE id=:id', { ':id': first.resultId }).result_status }));
  assert.deepEqual(after.samples, before.samples); assert.deepEqual(after.orders, before.orders); assert.deepEqual(after.results, before.results); assert.equal(second.duplicateOrder, true); assert.equal(second.duplicateResult, true); assert.equal(after.critical, 1); assert.equal(after.deliveries, 1); assert.equal(after.published, 'published');
  console.log('PASS duplicate order/result idempotency and critical-value rule integration');

  const center = await getInterfaceCenterData({ traceId: first.traceId }, options); assert(center.messages.length >= 4); assert(center.messages.every((message) => message.traceId === first.traceId)); assert(center.messages.every((message) => message.status === 'succeeded')); assert(center.deliveries.some((delivery) => delivery.ack_code === 'AA'));
  console.log('PASS trace search covers every closed-loop step and report ACK');
  console.log('PASS full interface end-to-end smoke completed');
})().catch((error) => { console.error('FAIL full interface end-to-end smoke'); console.error(error); process.exit(1); });
