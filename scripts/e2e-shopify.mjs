import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const themeRoot = join(repositoryRoot, 'playground/skeleton-theme');
const snippetPath = join(themeRoot, 'snippets/vite-tag.liquid');
const cliBin = join(repositoryRoot, 'dist/cli.js');
const host = '127.0.0.1';
const vitePort = environmentPort('SHOPIFY_VITE_PORT', 5173);
const shopifyPort = environmentPort('SHOPIFY_THEME_PORT', 9292);
const timeoutMs = environmentInteger('SHOPIFY_E2E_TIMEOUT_MS', 120_000, 1_000);
const requiredEnvironment = ['SHOPIFY_FLAG_STORE', 'SHOPIFY_CLI_THEME_TOKEN'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]?.trim());

if (missingEnvironment.length) {
  fail(`Missing required environment variable${missingEnvironment.length === 1 ? '' : 's'}: ${missingEnvironment.join(', ')}. See the end-to-end test documentation in README.md.`);
}
if (vitePort === shopifyPort) fail('SHOPIFY_VITE_PORT and SHOPIFY_THEME_PORT must use different ports.');

const originalSnippet = await readFile(snippetPath, 'utf8');
const children = [];
let stopping;
let interruptedSignal;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interruptedSignal = signal;
    void stopChildren().finally(() => {
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
    });
  });
}

try {
  await assertPortAvailable('Vite', vitePort);
  await assertPortAvailable('Shopify preview', shopifyPort);

  const developmentEnvironment = { ...process.env };
  delete developmentEnvironment.SHOPIFY_VITE_ORIGIN;
  developmentEnvironment.PATH = `${join(themeRoot, 'node_modules', '.bin')}${process.platform === 'win32' ? ';' : ':'}${developmentEnvironment.PATH ?? ''}`;
  developmentEnvironment.SHOPIFY_FLAG_PATH = themeRoot;
  const development = startProcess('vite-shopify-theme dev', process.execPath, [cliBin, 'dev', '--host', host, '--port', String(vitePort), '--strictPort', '--clearScreen', 'false'], {
    cwd: themeRoot,
    env: { ...developmentEnvironment, NO_COLOR: '1', SHOPIFY_CLI_NO_ANALYTICS: '1', SHOPIFY_FLAG_PORT: String(shopifyPort) },
  });
  await waitForResponse(`http://${host}:${vitePort}/@vite/client`, development, 'Vite');
  log(`Vite is ready at http://${host}:${vitePort}.`);

  const previewUrl = `http://${host}:${shopifyPort}/`;
  const html = await waitForPreview(previewUrl, development);
  log(`Shopify preview is ready at ${previewUrl}.`);

  const assetUrls = developmentAssetUrls(html);
  await verifyAsset(assetUrls.css, 'theme.css', '--vite-demo-accent');
  await verifyAsset(assetUrls.script, 'theme.ts', 'dataset.vite');
  log('The public dev command rendered Liquid and served both entrypoints through Vite.');
} catch (error) {
  if (!interruptedSignal) {
    process.exitCode = 1;
    console.error(`\nShopify end-to-end test failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} finally {
  await stopChildren();
  const restoredSnippet = await readFile(snippetPath, 'utf8');
  if (restoredSnippet !== originalSnippet) {
    process.exitCode = 1;
    console.error(`Shopify end-to-end test failed: ${snippetPath} was not restored after shutdown.`);
  } else if (!process.exitCode) {
    log('Processes stopped cleanly and the original generated snippet was restored.');
  }
}

function environmentPort(name, fallback) {
  return environmentInteger(name, fallback, 1, 65_535);
}

function environmentInteger(name, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${name} must be an integer from ${minimum} to ${maximum}; received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function fail(message) {
  console.error(`Shopify end-to-end test cannot start: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[e2e:shopify] ${message}`);
}

async function assertPortAvailable(label, port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error) => reject(new Error(`${label} port ${port} is unavailable: ${error.message}`)));
    server.listen({ host, port, exclusive: true }, () => server.close(resolve));
  });
}

function startProcess(label, command, args, options) {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  const remember = (chunk, stream) => {
    const text = chunk.toString();
    stream.write(text);
    output.push(text);
    if (output.join('').length > 12_000) output.shift();
  };
  child.stdout.on('data', (chunk) => remember(chunk, process.stdout));
  child.stderr.on('data', (chunk) => remember(chunk, process.stderr));
  child.on('error', (error) => output.push(`\n${error.message}`));
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const processState = { label, child, exited, output };
  children.push(processState);
  return processState;
}

async function waitForResponse(url, processState, label) {
  await poll(processState, async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
    return response;
  }, `${label} did not become ready at ${url}`);
}

async function waitForPreview(url, processState) {
  return poll(processState, async () => {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Shopify preview returned HTTP ${response.status}.`);
    const html = await response.text();
    developmentAssetUrls(html);
    return html;
  }, `Shopify preview did not render the Vite development tags at ${url}`);
}

async function poll(processState, operation, timeoutMessage) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      operation().catch((error) => { lastError = error; }),
      processState.exited.then(({ code, signal }) => {
        throw new Error(`${processState.label} exited before becoming ready (${signal ? `signal ${signal}` : `code ${code}`}).${diagnosticOutput(processState)}`);
      }),
    ]);
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${timeoutMessage} within ${timeoutMs}ms.${lastError ? ` Last error: ${lastError.message}` : ''}${diagnosticOutput(processState)}`);
}

function developmentAssetUrls(html) {
  const urls = [...html.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)=(['"])(.*?)\1[^>]*>/gis)]
    .map((match) => match[2].replaceAll('&amp;', '&'));
  const expectedOrigin = `http://${host}:${vitePort}`;
  const findEntry = (entry) => urls.find((value) => {
    try {
      const url = new URL(value);
      return url.origin === expectedOrigin && url.pathname === `/frontend/entrypoints/${entry}`;
    } catch {
      return false;
    }
  });
  const css = findEntry('theme.css');
  const script = findEntry('theme.ts');
  if (!css || !script) throw new Error('Expected development tags for theme.css and theme.ts were not present.');
  return { css, script };
}

async function verifyAsset(url, entry, expectedContent) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${entry} returned HTTP ${response.status} from Vite.`);
  const body = await response.text();
  if (!body.includes(expectedContent)) throw new Error(`${entry} did not contain the expected development content.`);
}

function diagnosticOutput(processState) {
  const output = processState.output.join('').trim();
  return output ? `\nRecent ${processState.label} output:\n${output}` : '';
}

async function stopChildren() {
  if (stopping) return stopping;
  stopping = Promise.all(children.map(async ({ child, exited }) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    const stopped = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]);
    if (!stopped) {
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
      await exited;
    }
  }));
  return stopping;
}
