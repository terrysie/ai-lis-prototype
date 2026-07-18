#!/usr/bin/env node
const assert = require('assert');
const { formatHl7Order, formatHl7Result, formatHl7Ack, parseHl7, frameAstm, parseAstm, applyFieldMappings } = require('../src/interface/protocols');

const order = parseHl7(formatHl7Order({ controlId: 'CTRL-1', patientId: 'P-SYN-1', orderNo: 'ORD-1', sampleBarcode: 'SYN-1', testCode: 'K', testName: 'Potassium' }));
assert.equal(order.messageType, 'ORM'); assert.equal(order.order.externalOrderNo, 'ORD-1'); assert.equal(order.sample.barcode, 'SYN-1'); assert.equal(order.patient.externalId, 'P-SYN-1');
console.log('PASS HL7 ORM parse/format and patient/order/sample mapping');

const result = parseHl7(formatHl7Result({ controlId: 'CTRL-2', patientId: 'P-SYN-1', orderNo: 'ORD-1', sampleBarcode: 'SYN-1', testCode: 'K', value: '6.8', unit: 'mmol/L', referenceRange: '3.5-5.5', abnormalFlag: 'H' }));
assert.equal(result.messageType, 'ORU'); assert.equal(result.result.value, '6.8'); assert.equal(result.result.unit, 'mmol/L'); assert.equal(result.result.abnormalFlag, 'H');
console.log('PASS HL7 ORU result mapping');

const ack = parseHl7(formatHl7Ack({ controlId: 'ACK-1', acknowledgedControlId: 'CTRL-2', code: 'AA' }));
assert.equal(ack.messageType, 'ACK'); assert.equal(ack.ack.code, 'AA'); assert.equal(ack.ack.messageControlId, 'CTRL-2');
console.log('PASS HL7 ACK parse/format');

const astmPayload = frameAstm(['H|\\^&|||CBC-SYNTHETIC', 'P|1||P-SYN-1', 'O|1|SYN-1|ORD-1|^^^WBC', 'R|1|^^^WBC|7.1|10^9/L|3.5-9.5|N||F', 'L|1|N']);
const astm = parseAstm(astmPayload); assert.equal(astm.sampleBarcode, 'SYN-1'); assert.equal(astm.results[0].testCode, 'WBC'); assert.equal(astm.results[0].value, '7.1');
assert.throws(() => parseAstm(astmPayload.replace('7.1', '7.2')), /checksum mismatch/);
console.log('PASS ASTM-like framing, parsing and checksum rejection');

const mapped = applyFieldMappings({ PID: { id: 'EXT-1' }, OBX: { value: 'H' } }, [
  { externalField: 'PID.id', localField: 'sample.externalPatientId', transform: {} },
  { externalField: 'OBX.value', localField: 'result.abnormalFlag', transform: { codeMap: { H: 'high' } } }
]);
assert.deepEqual(mapped, { sample: { externalPatientId: 'EXT-1' }, result: { abnormalFlag: 'high' } });
console.log('PASS configurable field mapping and code transform');
console.log('PASS interface protocol tests completed');
