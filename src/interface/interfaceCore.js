const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { initializeDatabase } = require('../database/initDatabase');
const { parseHl7, formatHl7Order, formatHl7Result, formatHl7Ack, parseAstm, frameAstm } = require('./protocols');

const SQL_WASM_PATH = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist');
const MESSAGE_STATUSES = ['received', 'queued', 'processing', 'succeeded', 'retrying', 'failed', 'dead-letter', 'cancelled'];
const FAULT_MODES = ['success', 'timeout', 'error', 'duplicate', 'invalid-field', 'disconnect'];
let sqlPromise;
let writeChain = Promise.resolve();

const loadSql = () => sqlPromise || (sqlPromise = initSqlJs({ locateFile: (file) => path.join(SQL_WASM_PATH, file) }));
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const addSeconds = (timestamp, seconds) => new Date(new Date(`${timestamp.replace(' ', 'T')}Z`).getTime() + seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
const json = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };

const getRows = (db, sql, params = {}) => {
  const statement = db.prepare(sql); const rows = [];
  try { statement.bind(params); while (statement.step()) rows.push(statement.getAsObject()); return rows; }
  finally { statement.free(); }
};
const getRow = (db, sql, params = {}) => getRows(db, sql, params)[0] || null;
const lastId = (db) => Number(getRow(db, 'SELECT last_insert_rowid() AS id').id);
const save = (db, databasePath) => fs.writeFileSync(databasePath, Buffer.from(db.export()));

const withDatabase = async (callback, options = {}, writable = false) => {
  const execute = async () => {
    const { databasePath } = await initializeDatabase(options);
    const SQL = await loadSql();
    const db = new SQL.Database(fs.readFileSync(databasePath));
    try {
      db.run('PRAGMA foreign_keys = ON');
      const result = await callback(db, databasePath);
      if (writable) save(db, databasePath);
      return result;
    } finally { db.close(); }
  };
  if (!writable) return execute();
  const pending = writeChain.then(execute, execute);
  writeChain = pending.catch(() => undefined);
  return pending;
};

const audit = (db, operationType, targetTable, targetId, before, after, remark, userId = 1) => db.run(`
  INSERT INTO audit_logs (user_id,module_name,operation_type,target_table,target_id,before_json,after_json,remark,created_at)
  VALUES (:userId,'Interface Center',:operationType,:targetTable,:targetId,:beforeJson,:afterJson,:remark,:createdAt)
`, { ':userId': userId, ':operationType': operationType, ':targetTable': targetTable, ':targetId': targetId || null, ':beforeJson': before === null ? null : JSON.stringify(before), ':afterJson': after === null ? null : JSON.stringify(after), ':remark': remark, ':createdAt': now() });

const adapterDto = (row) => ({
  id: Number(row.id), adapterId: row.adapter_id, name: row.adapter_name, type: row.adapter_type,
  protocol: row.protocol, direction: row.direction, enabled: Boolean(row.enabled),
  connection: json(row.connection_config_json, {}), parser: row.parser_name, formatter: row.formatter_name,
  healthStatus: row.health_status, lastCommunicationAt: row.last_communication_at,
  retryPolicy: json(row.retry_policy_json, {}), capabilityLabel: row.capability_label
});
const messageDto = (row) => ({
  id: Number(row.id), direction: row.direction, status: row.status, traceId: row.trace_id,
  source: row.source, destination: row.destination, protocol: row.protocol, messageType: row.message_type,
  rawPayload: row.raw_payload, normalizedPayload: json(row.normalized_payload_json), attempts: Number(row.processing_attempts),
  maxAttempts: Number(row.max_attempts), retryStrategy: row.retry_strategy, retryDelaySeconds: Number(row.retry_delay_seconds),
  lastError: row.last_error, nextRetryAt: row.next_retry_at, sampleId: row.related_sample_id ? Number(row.related_sample_id) : null,
  orderId: row.related_order_id ? Number(row.related_order_id) : null, reportId: row.related_report_id ? Number(row.related_report_id) : null,
  idempotencyKey: row.idempotency_key, createdAt: row.created_at, updatedAt: row.updated_at, processedAt: row.processed_at
});

const listAdapters = (options = {}) => withDatabase((db) => getRows(db, 'SELECT * FROM interface_adapters ORDER BY adapter_type, adapter_id').map(adapterDto), options);
const getMappings = (adapterId, options = {}) => withDatabase((db) => getRows(db, `SELECT m.* FROM interface_mappings m JOIN interface_adapters a ON a.id=m.adapter_id WHERE a.adapter_id=:adapterId ORDER BY m.field_key`, { ':adapterId': adapterId }).map((row) => ({ id: Number(row.id), fieldKey: row.field_key, externalField: row.external_field, localField: row.local_field, transform: json(row.transform_json, {}), enabled: Boolean(row.enabled) })), options);

const setAdapterEnabled = (adapterId, enabled, options = {}) => withDatabase((db) => {
  const before = getRow(db, 'SELECT * FROM interface_adapters WHERE adapter_id=:adapterId', { ':adapterId': adapterId });
  if (!before) throw new Error(`Adapter not found: ${adapterId}`);
  const stamp = now();
  db.run('UPDATE interface_adapters SET enabled=:enabled,health_status=:health,updated_at=:stamp WHERE adapter_id=:adapterId', { ':enabled': enabled ? 1 : 0, ':health': enabled ? 'online' : 'disabled', ':stamp': stamp, ':adapterId': adapterId });
  audit(db, enabled ? 'adapter_enable' : 'adapter_disable', 'interface_adapters', before.id, { enabled: Boolean(before.enabled) }, { enabled: Boolean(enabled) }, `${adapterId} ${enabled ? 'enabled' : 'disabled'}`);
  return adapterDto(getRow(db, 'SELECT * FROM interface_adapters WHERE adapter_id=:adapterId', { ':adapterId': adapterId }));
}, options, true);

const updateMapping = (mappingId, updates, options = {}) => withDatabase((db) => {
  const before = getRow(db, 'SELECT * FROM interface_mappings WHERE id=:id', { ':id': Number(mappingId) });
  if (!before) throw new Error(`Mapping not found: ${mappingId}`);
  const after = { externalField: String(updates.externalField || before.external_field), localField: String(updates.localField || before.local_field), transform: updates.transform || json(before.transform_json, {}), enabled: updates.enabled === undefined ? Boolean(before.enabled) : Boolean(updates.enabled) };
  db.run('UPDATE interface_mappings SET external_field=:external,local_field=:local,transform_json=:transform,enabled=:enabled,updated_at=:stamp WHERE id=:id', { ':external': after.externalField, ':local': after.localField, ':transform': JSON.stringify(after.transform), ':enabled': after.enabled ? 1 : 0, ':stamp': now(), ':id': Number(mappingId) });
  audit(db, 'mapping_update', 'interface_mappings', Number(mappingId), before, after, 'Interface field mapping updated');
  return after;
}, options, true);

const testAdapterConnection = (adapterId, options = {}) => withDatabase((db) => {
  const adapter = getRow(db, 'SELECT * FROM interface_adapters WHERE adapter_id=:adapterId', { ':adapterId': adapterId });
  if (!adapter) throw new Error(`Adapter not found: ${adapterId}`);
  const stamp = now(); const status = adapter.enabled ? 'online' : 'disabled';
  db.run('UPDATE interface_adapters SET health_status=:status,last_communication_at=:stamp,updated_at=:stamp WHERE id=:id', { ':status': status, ':stamp': stamp, ':id': adapter.id });
  db.run('INSERT INTO interface_connections (adapter_id,status,local_endpoint,connected_at,last_heartbeat_at,created_at) VALUES (:id,:status,:endpoint,:stamp,:stamp,:stamp)', { ':id': adapter.id, ':status': status, ':endpoint': JSON.stringify(json(adapter.connection_config_json, {})), ':stamp': stamp });
  return { adapterId, status, testedAt: stamp, localOnly: true };
}, options, true);

const enqueueMessage = (input, options = {}) => withDatabase((db) => {
  const existing = getRow(db, 'SELECT * FROM interface_messages WHERE idempotency_key=:key', { ':key': input.idempotencyKey });
  if (existing) return { message: messageDto(existing), duplicate: true };
  const policy = input.retryPolicy || { maxAttempts: 3, strategy: 'fixed', delaySeconds: 1 };
  const stamp = now();
  db.run(`INSERT INTO interface_messages (direction,status,trace_id,source,destination,protocol,message_type,raw_payload,normalized_payload_json,processing_attempts,max_attempts,retry_strategy,retry_delay_seconds,related_sample_id,related_order_id,related_report_id,idempotency_key,created_at,updated_at)
    VALUES (:direction,:status,:traceId,:source,:destination,:protocol,:messageType,:raw,:normalized,0,:maxAttempts,:strategy,:delay,:sampleId,:orderId,:reportId,:key,:stamp,:stamp)`, {
    ':direction': input.direction, ':status': input.status || (input.direction === 'inbound' ? 'received' : 'queued'), ':traceId': input.traceId,
    ':source': input.source, ':destination': input.destination, ':protocol': input.protocol, ':messageType': input.messageType,
    ':raw': typeof input.rawPayload === 'string' ? input.rawPayload : JSON.stringify(input.rawPayload), ':normalized': input.normalizedPayload ? JSON.stringify(input.normalizedPayload) : null,
    ':maxAttempts': Number(policy.maxAttempts || 3), ':strategy': policy.strategy || 'fixed', ':delay': Number(policy.delaySeconds || 1),
    ':sampleId': input.sampleId || null, ':orderId': input.orderId || null, ':reportId': input.reportId || null, ':key': input.idempotencyKey, ':stamp': stamp
  });
  return { message: messageDto(getRow(db, 'SELECT * FROM interface_messages WHERE id=:id', { ':id': lastId(db) })), duplicate: false };
}, options, true);

const normalizeMessage = (message) => {
  if (message.normalized_payload_json) return json(message.normalized_payload_json, {});
  if (/HL7/i.test(message.protocol)) return parseHl7(message.raw_payload);
  if (/ASTM/i.test(message.protocol)) return parseAstm(message.raw_payload);
  return json(message.raw_payload, { raw: message.raw_payload });
};

const createOrderBusinessData = (db, message, normalized) => {
  const orderData = normalized.order || normalized;
  const sampleData = normalized.sample || normalized;
  const patientData = normalized.patient || normalized;
  if (!orderData.externalOrderNo || !sampleData.barcode || !patientData.externalId) throw new Error('Order requires external order, patient and sample identifiers');
  const existingOrder = getRow(db, 'SELECT * FROM laboratory_orders WHERE external_order_no=:orderNo', { ':orderNo': orderData.externalOrderNo });
  if (existingOrder) return { orderId: Number(existingOrder.id), sampleId: Number(existingOrder.sample_id), duplicateBusinessData: true };
  const stamp = now();
  db.run(`INSERT INTO samples (sample_no,patient_code,source_type,department,test_group,sample_type,container_type,status,priority,external_patient_id,external_order_no,external_status_code,interface_trace_id,created_at,updated_at)
    VALUES (:sampleNo,:patientCode,'interface','Synthetic HIS','Interface intake','synthetic','synthetic','pending_receive',:priority,:externalPatient,:orderNo,:externalStatus,:traceId,:stamp,:stamp)`, {
    ':sampleNo': sampleData.barcode, ':patientCode': `P-SYN-${String(patientData.externalId).slice(-8)}`, ':priority': String(orderData.priority || 'routine').toLowerCase(), ':externalPatient': patientData.externalId, ':orderNo': orderData.externalOrderNo, ':externalStatus': orderData.status || 'SC', ':traceId': message.trace_id, ':stamp': stamp
  });
  const sampleId = lastId(db);
  db.run(`INSERT INTO laboratory_orders (external_order_no,patient_code,source_system,sample_id,order_status,priority,trace_id,ordered_at,created_at,updated_at)
    VALUES (:orderNo,:patientCode,:source,:sampleId,'accepted',:priority,:traceId,:orderedAt,:stamp,:stamp)`, { ':orderNo': orderData.externalOrderNo, ':patientCode': patientData.externalId, ':source': message.source, ':sampleId': sampleId, ':priority': orderData.priority || 'routine', ':traceId': message.trace_id, ':orderedAt': orderData.orderedAt || stamp, ':stamp': stamp });
  const orderId = lastId(db);
  const requestedCode = sampleData.testCode || 'K';
  const codeMap = { POTASSIUM: 'K', GLUCOSE: 'GLU' }; const localCode = codeMap[requestedCode] || requestedCode;
  const item = getRow(db, 'SELECT item_code FROM test_items WHERE item_code=:code', { ':code': localCode }) || getRow(db, 'SELECT item_code FROM test_items ORDER BY id LIMIT 1');
  db.run(`INSERT INTO laboratory_order_items (order_id,external_item_code,local_item_code,instrument_item_code,status,created_at) VALUES (:orderId,:externalCode,:localCode,:instrumentCode,'queued',:stamp)`, { ':orderId': orderId, ':externalCode': requestedCode, ':localCode': item.item_code, ':instrumentCode': item.item_code, ':stamp': stamp });
  db.run('UPDATE interface_messages SET related_sample_id=:sampleId,related_order_id=:orderId WHERE id=:messageId', { ':sampleId': sampleId, ':orderId': orderId, ':messageId': message.id });
  audit(db, 'his_order_intake', 'laboratory_orders', orderId, null, { sampleId, orderNo: orderData.externalOrderNo, traceId: message.trace_id }, 'Synthetic HIS order created local LIS business data');
  return { orderId, sampleId, duplicateBusinessData: false };
};

const createResultBusinessData = (db, message, normalized) => {
  const result = normalized.result || normalized.results?.[0] || normalized;
  const barcode = normalized.sample?.barcode || normalized.sampleBarcode || result.sampleBarcode;
  const sample = getRow(db, 'SELECT * FROM samples WHERE sample_no=:barcode', { ':barcode': barcode });
  if (!sample) throw new Error(`Sample not found for instrument result: ${barcode}`);
  const code = result.testCode || normalized.sample?.testCode || 'K';
  const item = getRow(db, 'SELECT * FROM test_items WHERE item_code=:code', { ':code': code });
  if (!item) throw new Error(`Test item not found: ${code}`);
  const existing = getRow(db, 'SELECT * FROM test_results WHERE interface_message_id=:messageId', { ':messageId': message.id });
  if (existing) return { resultId: Number(existing.id), duplicateBusinessData: true };
  const instrumentCode = message.source.includes('cbc') ? 'CBC-900-01' : message.source.includes('immuno') ? 'IMM-6000-01' : 'BIO-8000-01';
  const instrument = getRow(db, 'SELECT * FROM instruments WHERE instrument_code=:code', { ':code': instrumentCode });
  const value = String(result.value); const numeric = Number(value); const low = Number(item.critical_low); const high = Number(item.critical_high);
  const criticalFlag = Number.isFinite(high) && numeric >= high ? 'critical_high' : Number.isFinite(low) && numeric <= low ? 'critical_low' : 'none';
  const abnormalFlag = criticalFlag !== 'none' ? (criticalFlag.endsWith('high') ? 'high' : 'low') : ({ H: 'high', L: 'low', N: 'normal' }[result.abnormalFlag] || result.abnormalFlag || 'normal');
  const stamp = now();
  db.run(`INSERT INTO test_results (sample_id,test_item_id,result_value,unit,reference_range,abnormal_flag,critical_flag,instrument_id,qc_status,result_status,reported_at,interface_message_id,created_at,updated_at)
    VALUES (:sampleId,:itemId,:value,:unit,:range,:abnormal,:critical,:instrumentId,'passed','pending_review',:reportedAt,:messageId,:stamp,:stamp)`, { ':sampleId': sample.id, ':itemId': item.id, ':value': value, ':unit': result.unit || item.unit, ':range': result.referenceRange || item.reference_range, ':abnormal': abnormalFlag, ':critical': criticalFlag, ':instrumentId': instrument?.id || null, ':reportedAt': result.resultTime || stamp, ':messageId': message.id, ':stamp': stamp });
  const resultId = lastId(db);
  db.run(`INSERT INTO result_reviews (sample_id,result_id,review_status,review_opinion,review_action,created_at) VALUES (:sampleId,:resultId,'pending','Interface result awaiting human review','review','${stamp}')`, { ':sampleId': sample.id, ':resultId': resultId });
  if (criticalFlag !== 'none') db.run(`INSERT INTO critical_values (sample_id,result_id,item_name,result_value,unit,threshold_text,triggered_at,status,created_at,updated_at) VALUES (:sampleId,:resultId,:itemName,:value,:unit,:threshold,:stamp,'open',:stamp,:stamp)`, { ':sampleId': sample.id, ':resultId': resultId, ':itemName': item.item_name, ':value': value, ':unit': result.unit || item.unit, ':threshold': criticalFlag, ':stamp': stamp });
  db.run("UPDATE samples SET status='reviewing',updated_at=:stamp WHERE id=:sampleId", { ':stamp': stamp, ':sampleId': sample.id });
  db.run('UPDATE interface_messages SET related_sample_id=:sampleId,related_report_id=:resultId WHERE id=:messageId', { ':sampleId': sample.id, ':resultId': resultId, ':messageId': message.id });
  audit(db, 'instrument_result_intake', 'test_results', resultId, null, { sampleId: Number(sample.id), criticalFlag, traceId: message.trace_id }, 'Synthetic instrument result entered existing review flow');
  return { resultId, sampleId: Number(sample.id), criticalFlag, duplicateBusinessData: false };
};

const getFaultMode = (db, destination) => getRow(db, 'SELECT fault_mode FROM simulator_scenarios WHERE simulator_id=:id', { ':id': destination })?.fault_mode || 'success';
const processMessage = (messageId, options = {}) => withDatabase((db) => {
  const message = getRow(db, 'SELECT * FROM interface_messages WHERE id=:id', { ':id': Number(messageId) });
  if (!message) throw new Error(`Message not found: ${messageId}`);
  if (['succeeded', 'cancelled'].includes(message.status)) return messageDto(message);
  const attemptNo = Number(message.processing_attempts) + 1; const startedAt = now();
  db.run("UPDATE interface_messages SET status='processing',processing_attempts=:attempt,updated_at=:stamp WHERE id=:id", { ':attempt': attemptNo, ':stamp': startedAt, ':id': message.id });
  db.run("INSERT INTO interface_message_attempts (message_id,attempt_no,status,started_at) VALUES (:id,:attempt,'processing',:stamp)", { ':id': message.id, ':attempt': attemptNo, ':stamp': startedAt });
  const attemptId = lastId(db);
  try {
    const normalized = normalizeMessage(message);
    const faultMode = getFaultMode(db, message.destination);
    if (message.direction === 'outbound' && ['timeout', 'error', 'invalid-field', 'disconnect'].includes(faultMode)) throw new Error(`Simulator fault injected: ${faultMode}`);
    let businessResult = {};
    if (message.message_type === 'order') businessResult = createOrderBusinessData(db, message, normalized);
    else if (message.message_type === 'instrument-result') businessResult = createResultBusinessData(db, message, normalized);
    const completedAt = now();
    db.run("UPDATE interface_message_attempts SET status='succeeded',response_payload=:response,completed_at=:stamp WHERE id=:id", { ':response': JSON.stringify({ ack: 'AA', ...businessResult }), ':stamp': completedAt, ':id': attemptId });
    db.run("UPDATE interface_messages SET status='succeeded',normalized_payload_json=:normalized,last_error=NULL,next_retry_at=NULL,processed_at=:stamp,updated_at=:stamp WHERE id=:id", { ':normalized': JSON.stringify(normalized), ':stamp': completedAt, ':id': message.id });
    db.run('UPDATE interface_adapters SET last_communication_at=:stamp,health_status=CASE WHEN enabled=1 THEN \'online\' ELSE health_status END,updated_at=:stamp WHERE adapter_id IN (:source,:destination)', { ':stamp': completedAt, ':source': message.source, ':destination': message.destination });
    return messageDto(getRow(db, 'SELECT * FROM interface_messages WHERE id=:id', { ':id': message.id }));
  } catch (error) {
    const exhausted = attemptNo >= Number(message.max_attempts); const status = exhausted ? 'dead-letter' : 'retrying';
    const delay = message.retry_strategy === 'exponential' ? Number(message.retry_delay_seconds) * (2 ** (attemptNo - 1)) : Number(message.retry_delay_seconds);
    const stamp = now(); const nextRetry = exhausted ? null : addSeconds(stamp, delay);
    db.run("UPDATE interface_message_attempts SET status='failed',error_message=:error,completed_at=:stamp WHERE id=:id", { ':error': error.message, ':stamp': stamp, ':id': attemptId });
    db.run('UPDATE interface_messages SET status=:status,last_error=:error,next_retry_at=:nextRetry,updated_at=:stamp WHERE id=:id', { ':status': status, ':error': error.message, ':nextRetry': nextRetry, ':stamp': stamp, ':id': message.id });
    return messageDto(getRow(db, 'SELECT * FROM interface_messages WHERE id=:id', { ':id': message.id }));
  }
}, options, true);

const retryMessage = (messageId, options = {}) => withDatabase((db) => {
  const before = getRow(db, 'SELECT * FROM interface_messages WHERE id=:id', { ':id': Number(messageId) });
  if (!before || !['failed', 'retrying', 'dead-letter'].includes(before.status)) throw new Error('Only failed, retrying or dead-letter messages can be retried');
  db.run("UPDATE interface_messages SET status='queued',next_retry_at=NULL,last_error=NULL,updated_at=:stamp WHERE id=:id", { ':stamp': now(), ':id': before.id });
  audit(db, before.status === 'dead-letter' ? 'dead_letter_reprocess' : 'message_retry', 'interface_messages', before.id, { status: before.status }, { status: 'queued' }, 'Manual interface message reprocess');
  return Number(before.id);
}, options, true).then((id) => processMessage(id, options));

const cancelMessage = (messageId, options = {}) => withDatabase((db) => {
  const before = getRow(db, 'SELECT * FROM interface_messages WHERE id=:id', { ':id': Number(messageId) });
  if (!before || ['succeeded', 'cancelled'].includes(before.status)) throw new Error('Message cannot be cancelled in its current state');
  const stamp = now(); db.run("UPDATE interface_messages SET status='cancelled',next_retry_at=NULL,updated_at=:stamp WHERE id=:id", { ':stamp': stamp, ':id': before.id });
  audit(db, 'message_cancel', 'interface_messages', before.id, { status: before.status }, { status: 'cancelled' }, 'Manual interface message cancellation');
  return messageDto(getRow(db, 'SELECT * FROM interface_messages WHERE id=:id', { ':id': before.id }));
}, options, true);

const setSimulatorFault = (simulatorId, faultMode, options = {}) => withDatabase((db) => {
  if (!FAULT_MODES.includes(faultMode)) throw new Error(`Unsupported fault mode: ${faultMode}`);
  const before = getRow(db, 'SELECT * FROM simulator_scenarios WHERE simulator_id=:id', { ':id': simulatorId });
  if (!before) throw new Error(`Simulator not found: ${simulatorId}`);
  db.run('UPDATE simulator_scenarios SET fault_mode=:mode,connection_status=:status,updated_at=:stamp WHERE simulator_id=:id', { ':mode': faultMode, ':status': faultMode === 'disconnect' ? 'disconnected' : 'connected', ':stamp': now(), ':id': simulatorId });
  audit(db, 'simulator_fault_injection', 'simulator_scenarios', before.id, { faultMode: before.fault_mode }, { faultMode }, `${simulatorId} fault mode changed`);
  return { simulatorId, faultMode };
}, options, true);

const approvePublishAndDeliver = (resultId, traceId, destination = 'emr-simulator', options = {}) => withDatabase((db) => {
  const result = getRow(db, 'SELECT tr.*,s.sample_no,s.patient_code,ti.item_code,ti.item_name,rr.id review_id FROM test_results tr JOIN samples s ON s.id=tr.sample_id JOIN test_items ti ON ti.id=tr.test_item_id JOIN result_reviews rr ON rr.result_id=tr.id WHERE tr.id=:id ORDER BY rr.id DESC LIMIT 1', { ':id': resultId });
  if (!result) throw new Error(`Result not found: ${resultId}`); const stamp = now();
  db.run("UPDATE result_reviews SET review_status='approved',reviewer_id=2,review_opinion='Synthetic capability proof approval',review_action='release',reviewed_at=:stamp WHERE id=:id", { ':stamp': stamp, ':id': result.review_id });
  db.run("UPDATE test_results SET result_status='published',updated_at=:stamp WHERE id=:id", { ':stamp': stamp, ':id': resultId });
  audit(db, 'interface_demo_review_publish', 'test_results', resultId, { status: result.result_status }, { status: 'published', traceId }, 'One-click synthetic closed-loop demonstration');
  return { resultId, rawPayload: formatHl7Result({ controlId: `REPORT-${resultId}`, patientId: result.patient_code, orderNo: `REPORT-${resultId}`, sampleBarcode: result.sample_no, testCode: result.item_code, testName: result.item_name, value: result.result_value, unit: result.unit, referenceRange: result.reference_range, abnormalFlag: result.abnormal_flag === 'normal' ? 'N' : 'H', instrumentId: 'TERRY_LIS' }), destination };
}, options, true).then(async (delivery) => {
  const queued = await enqueueMessage({ direction: 'outbound', traceId, source: 'terry-lis', destination: delivery.destination, protocol: 'HL7v2/internal-mock', messageType: 'report', rawPayload: delivery.rawPayload, idempotencyKey: `report:${delivery.resultId}:${delivery.destination}`, reportId: delivery.resultId }, options);
  const processed = await processMessage(queued.message.id, options);
  await withDatabase((db) => {
    const adapter = getRow(db, 'SELECT id FROM interface_adapters WHERE adapter_id=:id', { ':id': delivery.destination.replace('-simulator', '-local') }) || getRow(db, "SELECT id FROM interface_adapters WHERE adapter_id='emr-local'");
    const stamp = now(); db.run(`INSERT OR IGNORE INTO external_report_deliveries (result_id,destination_adapter_id,message_id,trace_id,delivery_status,ack_code,ack_payload,delivered_at,created_at,updated_at) VALUES (:resultId,:adapterId,:messageId,:traceId,:status,:ack,:payload,:stamp,:stamp,:stamp)`, { ':resultId': delivery.resultId, ':adapterId': adapter.id, ':messageId': processed.id, ':traceId': traceId, ':status': processed.status === 'succeeded' ? 'acknowledged' : processed.status, ':ack': processed.status === 'succeeded' ? 'AA' : null, ':payload': processed.status === 'succeeded' ? formatHl7Ack({ controlId: `ACK-${processed.id}`, acknowledgedControlId: `REPORT-${delivery.resultId}` }) : null, ':stamp': stamp });
  }, options, true);
  return processed;
});

const runFullDemo = async ({ scenarioKey = `DEMO-${Date.now()}`, resultMode = 'critical', instrument = 'bio-synthetic', destination = 'emr-simulator' } = {}, options = {}) => {
  const suffix = String(scenarioKey).replace(/[^A-Za-z0-9]/g, '').slice(-12); const traceId = `TRACE-${suffix}`;
  const orderNo = `ORD-${suffix}`; const sampleBarcode = `SYN-${suffix}`; const patientId = `EXT-${suffix}`;
  const orderRaw = formatHl7Order({ controlId: `ORM-${suffix}`, patientId, orderNo, sampleBarcode, testCode: instrument === 'cbc-synthetic' ? 'WBC' : instrument === 'immuno-synthetic' ? 'HBSAG' : 'K' });
  const orderQueued = await enqueueMessage({ direction: 'inbound', traceId, source: 'his-local', destination: 'terry-lis', protocol: 'HL7v2/HTTP', messageType: 'order', rawPayload: orderRaw, idempotencyKey: `order:${orderNo}` }, options);
  const orderMessage = await processMessage(orderQueued.message.id, options);
  const orderDispatch = await enqueueMessage({ direction: 'outbound', traceId, source: 'terry-lis', destination: instrument, protocol: instrument === 'cbc-synthetic' ? 'ASTM/TCP' : instrument === 'immuno-synthetic' ? 'file-drop' : 'HL7v2/internal-mock', messageType: 'instrument-order', rawPayload: { orderNo, sampleBarcode }, normalizedPayload: { orderNo, sampleBarcode }, idempotencyKey: `instrument-order:${orderNo}:${instrument}`, sampleId: orderMessage.sampleId, orderId: orderMessage.orderId }, options);
  const dispatchMessage = await processMessage(orderDispatch.message.id, options);
  if (dispatchMessage.status !== 'succeeded') throw new Error(`Instrument dispatch ${dispatchMessage.status}: ${dispatchMessage.lastError}`);
  const profiles = { 'bio-synthetic': { testCode: 'K', name: 'Potassium', unit: 'mmol/L', range: '3.5-5.5', normal: '4.2', abnormal: '5.9', critical: '6.8', flag: { normal: 'N', abnormal: 'H', critical: 'H' } }, 'cbc-synthetic': { testCode: 'WBC', name: 'WBC', unit: '10^9/L', range: '3.5-9.5', normal: '7.1', abnormal: '18.4', critical: '35.2', flag: { normal: 'N', abnormal: 'H', critical: 'H' } }, 'immuno-synthetic': { testCode: 'HBSAG', name: 'HBsAg', unit: 'S/CO', range: '<1.0', normal: '0.2', abnormal: '1.4', critical: '18.6', flag: { normal: 'N', abnormal: 'H', critical: 'H' } } };
  const profile = profiles[instrument]; const resultValue = profile[resultMode] || profile.normal; const resultFlag = profile.flag[resultMode] || 'N';
  const resultPayload = instrument === 'cbc-synthetic'
    ? { protocol: 'ASTM/TCP', raw: frameAstm(['H|\\^&|||CBC-SYNTHETIC', `P|1||${patientId}`, `O|1|${sampleBarcode}|${orderNo}|^^^${profile.testCode}`, `R|1|^^^${profile.testCode}|${resultValue}|${profile.unit}|${profile.range}|${resultFlag}||F`, 'L|1|N']) }
    : instrument === 'immuno-synthetic'
      ? { protocol: 'file-drop', raw: JSON.stringify({ sample: { barcode: sampleBarcode, testCode: profile.testCode }, result: { testCode: profile.testCode, value: resultValue, unit: profile.unit, referenceRange: profile.range, abnormalFlag: resultFlag, status: 'F' } }) }
      : { protocol: 'HL7v2/internal-mock', raw: formatHl7Result({ controlId: `ORU-${suffix}`, patientId, orderNo, sampleBarcode, testCode: profile.testCode, testName: profile.name, value: resultValue, unit: profile.unit, referenceRange: profile.range, abnormalFlag: resultFlag, instrumentId: instrument }) };
  const resultQueued = await enqueueMessage({ direction: 'inbound', traceId, source: instrument, destination: 'terry-lis', protocol: resultPayload.protocol, messageType: 'instrument-result', rawPayload: resultPayload.raw, idempotencyKey: `result:${orderNo}:${profile.testCode}` }, options);
  const resultMessage = await processMessage(resultQueued.message.id, options);
  const instrumentFault = await withDatabase((db) => getFaultMode(db, instrument), options);
  const duplicateInjection = instrumentFault === 'duplicate'
    ? (await enqueueMessage({ direction: 'inbound', traceId, source: instrument, destination: 'terry-lis', protocol: resultPayload.protocol, messageType: 'instrument-result', rawPayload: resultPayload.raw, idempotencyKey: `result:${orderNo}:${profile.testCode}` }, options)).duplicate
    : false;
  const reportMessage = await approvePublishAndDeliver(resultMessage.reportId, traceId, destination, options);
  await withDatabase((db) => db.run('UPDATE simulator_scenarios SET last_run_at=:stamp WHERE simulator_id IN (:his,:instrument,:destination)', { ':stamp': now(), ':his': 'his-simulator', ':instrument': instrument, ':destination': destination }), options, true);
  return { traceId, orderNo, sampleBarcode, orderMessageId: orderMessage.id, sampleId: orderMessage.sampleId, orderId: orderMessage.orderId, resultMessageId: resultMessage.id, resultId: resultMessage.reportId, resultStatus: resultMessage.status, reportMessageId: reportMessage.id, reportStatus: reportMessage.status, duplicateOrder: orderQueued.duplicate, duplicateResult: resultQueued.duplicate, duplicateInjection };
};

const deliverPublishedReport = (resultId, destination = 'emr-simulator', options = {}) => withDatabase((db) => {
  const result = getRow(db, 'SELECT tr.*,s.sample_no,s.patient_code,ti.item_code,ti.item_name FROM test_results tr JOIN samples s ON s.id=tr.sample_id JOIN test_items ti ON ti.id=tr.test_item_id WHERE tr.id=:id', { ':id': Number(resultId) });
  if (!result || result.result_status !== 'published') throw new Error('Only a published report can be delivered');
  const traceId = getRow(db, 'SELECT interface_trace_id trace_id FROM samples WHERE id=:id', { ':id': result.sample_id })?.trace_id || `TRACE-REPORT-${resultId}-${Date.now()}`;
  const rawPayload = formatHl7Result({ controlId: `REPORT-${resultId}`, patientId: result.patient_code, orderNo: `REPORT-${resultId}`, sampleBarcode: result.sample_no, testCode: result.item_code, testName: result.item_name, value: result.result_value, unit: result.unit, referenceRange: result.reference_range, abnormalFlag: result.abnormal_flag === 'normal' ? 'N' : 'H', instrumentId: 'TERRY_LIS' });
  return { resultId: Number(resultId), destination, traceId, rawPayload };
}, options).then(async (delivery) => {
  const queued = await enqueueMessage({ direction: 'outbound', traceId: delivery.traceId, source: 'terry-lis', destination: delivery.destination, protocol: 'HL7v2/internal-mock', messageType: 'report', rawPayload: delivery.rawPayload, idempotencyKey: `published-report:${delivery.resultId}:${delivery.destination}`, reportId: delivery.resultId }, options);
  const message = await processMessage(queued.message.id, options);
  await withDatabase((db) => {
    const adapter = getRow(db, "SELECT id FROM interface_adapters WHERE adapter_id='emr-local'"); const stamp = now();
    db.run(`INSERT OR REPLACE INTO external_report_deliveries (id,result_id,destination_adapter_id,message_id,trace_id,delivery_status,ack_code,ack_payload,delivered_at,created_at,updated_at)
      VALUES ((SELECT id FROM external_report_deliveries WHERE result_id=:resultId AND destination_adapter_id=:adapterId AND trace_id=:traceId),:resultId,:adapterId,:messageId,:traceId,:status,:ack,:payload,:stamp,COALESCE((SELECT created_at FROM external_report_deliveries WHERE result_id=:resultId AND destination_adapter_id=:adapterId AND trace_id=:traceId),:stamp),:stamp)`, { ':resultId': delivery.resultId, ':adapterId': adapter.id, ':messageId': message.id, ':traceId': delivery.traceId, ':status': message.status === 'succeeded' ? 'acknowledged' : message.status, ':ack': message.status === 'succeeded' ? 'AA' : null, ':payload': message.status === 'succeeded' ? formatHl7Ack({ controlId: `ACK-${message.id}`, acknowledgedControlId: `REPORT-${delivery.resultId}` }) : null, ':stamp': stamp });
  }, options, true);
  return { message, traceId: delivery.traceId, deliveryStatus: message.status === 'succeeded' ? 'acknowledged' : message.status, ackCode: message.status === 'succeeded' ? 'AA' : null };
});

const getInterfaceCenterData = (filters = {}, options = {}) => withDatabase((db) => {
  const clauses = []; const params = {};
  if (filters.status) { clauses.push('status=:status'); params[':status'] = filters.status; }
  if (filters.direction) { clauses.push('direction=:direction'); params[':direction'] = filters.direction; }
  if (filters.traceId) { clauses.push('trace_id LIKE :traceId'); params[':traceId'] = `%${filters.traceId}%`; }
  const messages = getRows(db, `SELECT * FROM interface_messages ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 200`, params).map(messageDto);
  const counts = Object.fromEntries(getRows(db, 'SELECT status,COUNT(*) count FROM interface_messages GROUP BY status').map((row) => [row.status, Number(row.count)]));
  const traffic = getRow(db, "SELECT SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) inbound,SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) outbound FROM interface_messages WHERE date(created_at)=date('now')") || {};
  return { adapters: getRows(db, 'SELECT * FROM interface_adapters ORDER BY adapter_type,adapter_id').map(adapterDto), mappings: getRows(db, 'SELECT * FROM interface_mappings ORDER BY adapter_id,id').map((row) => ({ id: Number(row.id), adapterId: Number(row.adapter_id), fieldKey: row.field_key, externalField: row.external_field, localField: row.local_field, enabled: Boolean(row.enabled) })), messages, attempts: getRows(db, 'SELECT * FROM interface_message_attempts ORDER BY id DESC LIMIT 300').map((row) => ({ ...row, id: Number(row.id), message_id: Number(row.message_id), attempt_no: Number(row.attempt_no) })), simulators: getRows(db, 'SELECT * FROM simulator_scenarios ORDER BY simulator_type,simulator_id').map((row) => ({ id: Number(row.id), simulatorId: row.simulator_id, type: row.simulator_type, transport: row.transport, profile: json(row.profile_json, {}), faultMode: row.fault_mode, connectionStatus: row.connection_status, deterministicRule: row.deterministic_rule, lastRunAt: row.last_run_at })), deliveries: getRows(db, 'SELECT * FROM external_report_deliveries ORDER BY id DESC LIMIT 100'), stats: { totalAdapters: Number(getRow(db, 'SELECT COUNT(*) count FROM interface_adapters').count), onlineAdapters: Number(getRow(db, "SELECT COUNT(*) count FROM interface_adapters WHERE enabled=1 AND health_status='online'").count), offlineAdapters: Number(getRow(db, "SELECT COUNT(*) count FROM interface_adapters WHERE enabled=0 OR health_status!='online'").count), todayInbound: Number(traffic.inbound || 0), todayOutbound: Number(traffic.outbound || 0), ...counts }, messageStatuses: MESSAGE_STATUSES, faultModes: FAULT_MODES };
}, options);

module.exports = { MESSAGE_STATUSES, FAULT_MODES, listAdapters, getMappings, setAdapterEnabled, updateMapping, testAdapterConnection, enqueueMessage, processMessage, retryMessage, cancelMessage, setSimulatorFault, runFullDemo, deliverPublishedReport, getInterfaceCenterData };
