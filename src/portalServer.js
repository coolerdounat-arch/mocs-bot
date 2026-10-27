require('dotenv').config();
const http = require('http');
const { handleWebInterface } = require('./services/webInterface');

const port = Number(process.env.PORTAL_PORT || 3102);
const portalClient = { guilds: { cache: { first: () => null } } };

const server = http.createServer(async (request, response) => {
  try {
    const handled = await handleWebInterface(request, response, portalClient);
    if (!handled) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  } catch (error) {
    console.error('[portal] Request failed:', error);
    if (!response.headersSent) response.writeHead(500);
    response.end('Internal server error');
  }
});

server.on('error', (error) => {
  console.error('[portal] Server failed:', error);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[portal] Listening on 127.0.0.1:${port}.`);
});