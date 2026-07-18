const ASTM = Object.freeze({ STX: '\x02', ETX: '\x03', EOT: '\x04', CR: '\r', LF: '\n' });

const splitComponents = (value = '') => String(value).split('^');
const field = (segments, name, index, component = null) => {
  const segment = segments.find((item) => item[0] === name);
  const value = segment?.[index] || '';
  return component === null ? value : (splitComponents(value)[component] || '');
};

const parseHl7 = (payload) => {
  const segments = String(payload || '').trim().split(/\r?\n|\r/).filter(Boolean).map((line) => line.split('|'));
  if (!segments.length || segments[0][0] !== 'MSH') throw new Error('HL7 message must begin with MSH');
  const messageType = field(segments, 'MSH', 8, 0);
  const triggerEvent = field(segments, 'MSH', 8, 1);
  const controlId = field(segments, 'MSH', 9);
  const obx = segments.find((item) => item[0] === 'OBX') || [];
  return {
    protocol: 'HL7v2', messageType, triggerEvent, controlId,
    patient: { externalId: field(segments, 'PID', 3, 0), name: field(segments, 'PID', 5) },
    order: { externalOrderNo: field(segments, 'ORC', 2, 0), status: field(segments, 'ORC', 5), orderedAt: field(segments, 'ORC', 9) },
    sample: { barcode: field(segments, 'OBR', 3, 0), testCode: field(segments, 'OBR', 4, 0), testName: field(segments, 'OBR', 4, 1) },
    result: obx.length ? { valueType: obx[2], testCode: splitComponents(obx[3])[0] || '', value: obx[5] || '', unit: obx[6] || '', referenceRange: obx[7] || '', abnormalFlag: obx[8] || '', status: obx[11] || '', resultTime: obx[14] || '' } : null,
    ack: messageType === 'ACK' ? { code: field(segments, 'MSA', 1), messageControlId: field(segments, 'MSA', 2), text: field(segments, 'MSA', 3) } : null
  };
};

const hl7Timestamp = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
};

const formatHl7Order = ({ controlId, patientId, patientName = 'SYNTHETIC^PATIENT', orderNo, sampleBarcode, testCode, testName = testCode, priority = 'R' }) => [
  `MSH|^~\\&|HIS_SIM|LOCAL|TERRY_LIS|LAB|${hl7Timestamp()}||ORM^O01|${controlId}|P|2.3`,
  `PID|1||${patientId}||${patientName}`,
  `ORC|NW|${orderNo}|||SC||||${hl7Timestamp()}`,
  `OBR|1|${orderNo}|${sampleBarcode}|${testCode}^${testName}|||${hl7Timestamp()}||||||||||||||||||${priority}`
].join('\r');

const formatHl7Result = ({ controlId, patientId, orderNo, sampleBarcode, testCode, testName = testCode, value, unit, referenceRange, abnormalFlag = 'N', status = 'F', instrumentId = 'SYNTHETIC' }) => [
  `MSH|^~\\&|${instrumentId}|LOCAL|TERRY_LIS|LAB|${hl7Timestamp()}||ORU^R01|${controlId}|P|2.3`,
  `PID|1||${patientId}`,
  `ORC|RE|${orderNo}|||CM`,
  `OBR|1|${orderNo}|${sampleBarcode}|${testCode}^${testName}`,
  `OBX|1|NM|${testCode}^${testName}||${value}|${unit}|${referenceRange}|${abnormalFlag}|||${status}|||${hl7Timestamp()}`
].join('\r');

const formatHl7Ack = ({ controlId, acknowledgedControlId, code = 'AA', text = 'Accepted' }) => [
  `MSH|^~\\&|TERRY_LIS|LAB|LOCAL_SIM|LOCAL|${hl7Timestamp()}||ACK|${controlId}|P|2.3`,
  `MSA|${code}|${acknowledgedControlId}|${text}`
].join('\r');

const astmChecksum = (content) => [...String(content)].reduce((sum, char) => sum + char.charCodeAt(0), 0).toString(16).toUpperCase().slice(-2).padStart(2, '0');
const frameAstm = (records, frameNumber = 1) => {
  const body = `${frameNumber}${records.join(ASTM.CR)}${ASTM.CR}${ASTM.ETX}`;
  return `${ASTM.STX}${body}${astmChecksum(body)}${ASTM.CR}${ASTM.LF}${ASTM.EOT}`;
};
const parseAstm = (payload) => {
  const text = String(payload || '');
  const start = text.indexOf(ASTM.STX);
  const end = text.indexOf(ASTM.ETX, start + 1);
  if (start < 0 || end < 0) throw new Error('ASTM frame missing STX/ETX');
  const body = text.slice(start + 1, end + 1);
  const expected = text.slice(end + 1, end + 3).toUpperCase();
  const actual = astmChecksum(body);
  if (expected !== actual) throw new Error(`ASTM checksum mismatch: expected ${expected}, calculated ${actual}`);
  const records = body.slice(1, -1).split(ASTM.CR).filter(Boolean).map((record) => record.split('|'));
  const patient = records.find((item) => item[0] === 'P') || [];
  const order = records.find((item) => item[0] === 'O') || [];
  const results = records.filter((item) => item[0] === 'R').map((item) => ({ testCode: splitComponents(item[2])[3] || item[2], value: item[3], unit: item[4], referenceRange: item[5], abnormalFlag: item[6], status: item[8] }));
  return { protocol: 'ASTM-like', frameNumber: Number(body[0]), patientId: patient[3] || '', sampleBarcode: order[2] || '', orderNo: order[3] || '', testCode: splitComponents(order[4])[3] || order[4] || '', results, records };
};

const applyFieldMappings = (source, mappings) => mappings.reduce((target, mapping) => {
  const transform = typeof mapping.transform === 'string' ? JSON.parse(mapping.transform || '{}') : (mapping.transform || {});
  const rawValue = String(mapping.externalField || '').split('.').reduce((value, key) => value?.[key], source);
  const value = transform.codeMap?.[rawValue] ?? rawValue;
  String(mapping.localField || '').split('.').reduce((cursor, key, index, keys) => {
    if (index === keys.length - 1) cursor[key] = value;
    else cursor[key] = cursor[key] || {};
    return cursor[key];
  }, target);
  return target;
}, {});

module.exports = { ASTM, parseHl7, formatHl7Order, formatHl7Result, formatHl7Ack, astmChecksum, frameAstm, parseAstm, applyFieldMappings };
