const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { enqueueMessage, processMessage } = require('./interfaceCore');
const { parseHl7, parseAstm, formatHl7Ack } = require('./protocols');

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  request.on('data', (chunk) => { size += chunk.length; if (size > 1024 * 1024) reject(new Error('Payload exceeds 1 MB')); else chunks.push(chunk); });
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  request.on('error', reject);
});
const reply = (response, status, body, type = 'application/json; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type }); response.end(typeof body === 'string' ? body : JSON.stringify(body)); };

class InterfaceRuntime {
  constructor({ databaseOptions = {}, dataDirectory, httpPort = 17771, tcpPort = 17772 } = {}) {
    this.databaseOptions = databaseOptions; this.dataDirectory = dataDirectory; this.httpPort = httpPort; this.tcpPort = tcpPort;
    this.httpServer = null; this.tcpServer = null; this.watchers = [];
  }

  async acceptInbound({ source, protocol, messageType, rawPayload, idempotencyKey, traceId }) {
    const queued = await enqueueMessage({ direction: 'inbound', traceId, source, destination: 'terry-lis', protocol, messageType, rawPayload, idempotencyKey }, this.databaseOptions);
    const message = await processMessage(queued.message.id, this.databaseOptions);
    return { duplicate: queued.duplicate, message };
  }

  startHttp() {
    this.httpServer = http.createServer(async (request, response) => {
      try {
        if (request.method === 'GET' && request.url === '/health') return reply(response, 200, { status: 'ok', service: 'TERRY-LIS local interface capability proof', production: false });
        if (request.method !== 'POST') return reply(response, 404, { error: 'Not found' });
        const body = await readBody(request);
        if (request.url === '/hl7') {
          const parsed = parseHl7(body); const traceId = request.headers['x-trace-id'] || `TRACE-${parsed.controlId}`;
          const result = await this.acceptInbound({ source: 'his-local', protocol: 'HL7v2/HTTP', messageType: parsed.messageType === 'ORM' ? 'order' : 'instrument-result', rawPayload: body, idempotencyKey: request.headers['idempotency-key'] || `http:${parsed.controlId}`, traceId });
          return reply(response, result.message.status === 'succeeded' ? 200 : 422, formatHl7Ack({ controlId: `ACK-${result.message.id}`, acknowledgedControlId: parsed.controlId, code: result.message.status === 'succeeded' ? 'AA' : 'AE', text: result.message.lastError || 'Accepted' }), 'text/plain; charset=utf-8');
        }
        if (request.url === '/billing') {
          const input = JSON.parse(body); const queued = await enqueueMessage({ direction: 'inbound', traceId: input.traceId || `TRACE-BILL-${Date.now()}`, source: 'billing-local', destination: 'terry-lis', protocol: 'REST/HTTP', messageType: 'billing-status', rawPayload: body, normalizedPayload: input, idempotencyKey: request.headers['idempotency-key'] || input.idempotencyKey }, this.databaseOptions);
          const message = await processMessage(queued.message.id, this.databaseOptions); return reply(response, 200, { acknowledged: message.status === 'succeeded', duplicate: queued.duplicate, traceId: message.traceId });
        }
        return reply(response, 404, { error: 'Not found' });
      } catch (error) { return reply(response, 400, { error: error.message }); }
    });
    this.httpServer.on('error', (error) => console.error('Interface HTTP simulator unavailable:', error.message));
    this.httpServer.listen(this.httpPort, '127.0.0.1');
  }

  startTcp() {
    this.tcpServer = net.createServer((socket) => {
      let payload = '';
      socket.setEncoding('latin1');
      socket.on('data', async (chunk) => {
        payload += chunk;
        if (!payload.includes('\x04')) return;
        try {
          const parsed = parseAstm(payload); const key = `tcp:${parsed.orderNo}:${parsed.sampleBarcode}:${parsed.results[0]?.testCode || parsed.testCode}`;
          const result = await this.acceptInbound({ source: 'cbc-synthetic', protocol: 'ASTM/TCP', messageType: parsed.results.length ? 'instrument-result' : 'instrument-order', rawPayload: payload, idempotencyKey: key, traceId: `TRACE-${parsed.orderNo || parsed.sampleBarcode}` });
          socket.end(result.message.status === 'succeeded' ? '\x06' : '\x15');
        } catch { socket.end('\x15'); }
      });
    });
    this.tcpServer.on('error', (error) => console.error('Interface TCP simulator unavailable:', error.message));
    this.tcpServer.listen(this.tcpPort, '127.0.0.1');
  }

  startFileDrop() {
    ['exam', 'immuno'].forEach((name) => {
      const directory = path.join(this.dataDirectory, 'interface-drop', name); fs.mkdirSync(directory, { recursive: true });
      const watcher = fs.watch(directory, async (_event, filename) => {
        if (!filename || !filename.endsWith('.json') || filename.endsWith('.processed.json')) return;
        const inputPath = path.join(directory, filename);
        try {
          if (!fs.existsSync(inputPath)) return;
          const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
          const result = await this.acceptInbound({ source: name === 'exam' ? 'exam-local' : 'immuno-synthetic', protocol: 'file-drop', messageType: input.messageType || (name === 'exam' ? 'order' : 'instrument-result'), rawPayload: JSON.stringify(input), idempotencyKey: input.idempotencyKey || `file:${name}:${filename}`, traceId: input.traceId || `TRACE-FILE-${filename}` });
          fs.renameSync(inputPath, path.join(directory, `${filename}.processed.json`));
          fs.writeFileSync(path.join(directory, `${filename}.ack.json`), JSON.stringify({ status: result.message.status, traceId: result.message.traceId }, null, 2));
        } catch (error) { fs.writeFileSync(path.join(directory, `${filename}.error.json`), JSON.stringify({ error: error.message }, null, 2)); }
      });
      this.watchers.push(watcher);
    });
  }

  start() { this.startHttp(); this.startTcp(); this.startFileDrop(); return { http: `http://127.0.0.1:${this.httpPort}`, tcp: `127.0.0.1:${this.tcpPort}`, fileDrop: path.join(this.dataDirectory, 'interface-drop') }; }
  stop() { this.httpServer?.close(); this.tcpServer?.close(); this.watchers.forEach((watcher) => watcher.close()); this.watchers = []; }
}

module.exports = { InterfaceRuntime };
