require('dotenv').config();
const http = require('http');
const { handleWebInterface } = require('../src/services/webInterface');

const port = Number(process.env.WEB_PREVIEW_PORT || 3101);
const previewClient = { guilds: { cache: { first: () => null } } };

const server = http.createServer(async (request, response) => {
  try {
    const handled = await handleWebInterface(request, response, previewClient);
    if (!handled) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  } catch (error) {
    console.error('Portal preview request failed:', error);
    if (!response.headersSent) response.writeHead(500);
    response.end('Internal server error');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Portal preview could not bind to 127.0.0.1:${port}. Close the other preview or set WEB_PREVIEW_PORT to a free port.`);
    process.exitCode = 1;
    return;
  }
  console.error('Portal preview server failed:', error);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Portal preview available at http://127.0.0.1:${port}/portal/`);
  console.log('This preview does not connect to Discord as the bot or modify system services.');
});