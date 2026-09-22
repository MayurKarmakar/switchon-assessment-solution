import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(projectDirectory, 'dist');
const indexPath = path.join(distDirectory, 'index.html');
const publicPort = Number(process.env.PORT ?? 4173);
const internalApiPort = Number(process.env.INTERNAL_API_PORT ?? 8788);

if (!Number.isInteger(publicPort) || publicPort <= 0) {
  throw new Error('PORT must be a positive integer.');
}

if (!Number.isInteger(internalApiPort) || internalApiPort <= 0) {
  throw new Error('INTERNAL_API_PORT must be a positive integer.');
}

if (publicPort === internalApiPort) {
  throw new Error('PORT and INTERNAL_API_PORT must use different ports.');
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(message);
}

function proxyApiRequest(request, response) {
  const proxyRequest = http.request(
    {
      host: '127.0.0.1',
      port: internalApiPort,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: `127.0.0.1:${internalApiPort}`,
      },
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );

  proxyRequest.on('error', (error) => {
    console.error('API proxy request failed:', error.message);
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { code: 'bad_gateway', message: 'API unavailable.' } }));
      return;
    }
    response.destroy(error);
  });

  request.pipe(proxyRequest);
}

async function sendFile(request, response, filePath) {
  const fileStats = await stat(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const headers = {
    'content-type': contentTypes.get(extension) ?? 'application/octet-stream',
    'content-length': fileStats.size,
    'cache-control': filePath === indexPath
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  };

  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const fileStream = createReadStream(filePath);
  fileStream.on('error', (error) => response.destroy(error));
  fileStream.pipe(response);
}

async function serveFrontend(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed.');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    sendText(response, 400, 'Invalid request path.');
    return;
  }

  const relativePath = pathname.replace(/^\/+/, '');
  const requestedPath = path.resolve(distDirectory, relativePath || 'index.html');
  const isInsideDist = requestedPath === distDirectory
    || requestedPath.startsWith(`${distDirectory}${path.sep}`);

  if (!isInsideDist) {
    sendText(response, 400, 'Invalid request path.');
    return;
  }

  try {
    const requestedStats = await stat(requestedPath);
    if (requestedStats.isFile()) {
      await sendFile(request, response, requestedPath);
      return;
    }
  } catch {
    if (path.extname(relativePath)) {
      sendText(response, 404, 'Not found.');
      return;
    }
  }

  await sendFile(request, response, indexPath);
}

function apiIsReady() {
  return new Promise((resolve) => {
    const healthRequest = http.get(
      { host: '127.0.0.1', port: internalApiPort, path: '/api/health' },
      (healthResponse) => {
        healthResponse.resume();
        resolve(healthResponse.statusCode === 200);
      },
    );
    healthRequest.setTimeout(500, () => healthRequest.destroy());
    healthRequest.on('error', () => resolve(false));
  });
}

async function waitForApi() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await apiIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The API did not become ready within 15 seconds.');
}

await access(indexPath);

const apiProcess = spawn(process.execPath, ['server/index.mjs'], {
  cwd: projectDirectory,
  env: { ...process.env, PORT: String(internalApiPort) },
  stdio: 'inherit',
});

let publicServer;
let isStopping = false;

function stopProcesses(signal) {
  if (isStopping) return;
  isStopping = true;

  if (apiProcess.exitCode === null) apiProcess.kill(signal);

  const exitCleanly = () => process.exit(0);
  if (publicServer?.listening) {
    publicServer.close(exitCleanly);
    publicServer.closeAllConnections();
  } else {
    exitCleanly();
  }

  setTimeout(exitCleanly, 5_000).unref();
}

process.once('SIGINT', () => stopProcesses('SIGINT'));
process.once('SIGTERM', () => stopProcesses('SIGTERM'));

apiProcess.on('exit', (code, signal) => {
  if (isStopping) return;
  console.error(`API process exited unexpectedly (${signal ?? code ?? 'unknown'}).`);
  const exitCode = code && code !== 0 ? code : 1;
  if (publicServer?.listening) {
    publicServer.close(() => process.exit(exitCode));
    return;
  }
  process.exit(exitCode);
});

try {
  await waitForApi();

  publicServer = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      proxyApiRequest(request, response);
      return;
    }

    serveFrontend(request, response).catch((error) => {
      console.error('Static file request failed:', error.message);
      if (!response.headersSent) sendText(response, 500, 'Internal server error.');
      else response.destroy(error);
    });
  });

  publicServer.listen(publicPort, '0.0.0.0', () => {
    console.log(`MediaVault → http://0.0.0.0:${publicPort}`);
  });
} catch (error) {
  if (apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  throw error;
}
