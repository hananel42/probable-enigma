import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localCompilerCandidate = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const localCompiler = existsSync(localCompilerCandidate) ? localCompilerCandidate : null;
const COMPILE_TIMEOUT_MS = 120_000;
const TEST_PROCESS_TIMEOUT_MS = 180_000;
const PER_TEST_TIMEOUT_MS = 30_000;
const TEST_CONCURRENCY = 1;

/** Discover every regression suite so newly added tests cannot be silently omitted. */
async function discoverTestEntries(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await discoverTestEntries(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      found.push(path.relative(projectRoot, fullPath).split(path.sep).join('/'));
    }
  }
  return found.sort((left, right) => left.localeCompare(right));
}

/** Run a child with a deadline; kill its process group on timeout to avoid orphaned workers. */
function run(command, args, { timeoutMs, inherit = false, killProcessGroup = false }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      windowsHide: true,
      detached: killProcessGroup && process.platform !== 'win32',
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timeoutHandle;
    let forceKillHandle;

    const clearTimers = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
    };
    const terminate = (signal) => {
      if (!child.pid) return;
      try {
        if (killProcessGroup && process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal === 'SIGKILL' ? undefined : signal);
      } catch {
        // A process may exit between the timeout and the signal.
      }
    };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(result);
    };

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      forceKillHandle = setTimeout(() => {
        terminate('SIGKILL');
        // Some toolchains leave descendants holding inherited pipes open. Do not wait forever.
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle({ status: null, signal: 'SIGKILL', error: null, stdout, stderr, timedOut: true });
      }, 2_000);
    }, timeoutMs);

    if (!inherit) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
    }

    child.on('error', error => {
      settle({ status: null, signal: null, error, stdout, stderr, timedOut });
    });
    child.on('close', (status, signal) => {
      settle({ status, signal, error: null, stdout, stderr, timedOut });
    });
  });
}

function describeFailure(label, result, timeoutMs) {
  if (result.timedOut) return `${label} exceeded its ${timeoutMs} ms process timeout.`;
  if (result.error) return `${label} could not be started: ${result.error.message}`;
  if (result.status !== 0) return `${label} failed (exit=${result.status ?? 'unknown'}, signal=${result.signal ?? 'none'}).`;
  return '';
}

function addNodeEsmExtensions(source, file, fileSet) {
  const importPattern = /(\bfrom\s*['"]|\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\)?)/g;
  return source.replace(importPattern, (whole, prefix, specifier, suffix) => {
    const extension = path.extname(specifier.split('?')[0]);
    if (extension) return whole;
    const absoluteBase = path.resolve(path.dirname(file), specifier);
    if (fileSet.has(path.resolve(`${absoluteBase}.js`))) return `${prefix}${specifier}.js${suffix}`;
    if (fileSet.has(path.resolve(path.join(absoluteBase, 'index.js')))) return `${prefix}${specifier}/index.js${suffix}`;
    throw new Error(`Could not resolve compiled ESM import '${specifier}' from '${path.relative(projectRoot, file)}'.`);
  });
}

const testEntries = await discoverTestEntries(path.join(projectRoot, 'src'));
if (testEntries.length === 0) throw new Error('No *.test.ts regression files were found under src/.');
console.info(`[test] Discovered ${testEntries.length} TypeScript regression test files.`);

const tempRoot = await mkdtemp(path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'craftbound-engine-tests-'));
const outputRoot = path.join(tempRoot, 'build');
const emptyTypeRoots = path.join(tempRoot, 'empty-types');
await mkdir(outputRoot, { recursive: true });
await mkdir(emptyTypeRoots, { recursive: true });
await writeFile(path.join(outputRoot, 'package.json'), '{"type":"module"}\n');

try {
  const compileArgs = [
    '--noCheck', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler',
    '--lib', 'ES2022,DOM', '--typeRoots', emptyTypeRoots,
    '--outDir', outputRoot, '--rootDir', projectRoot,
    '--skipLibCheck', '--esModuleInterop', '--noEmitOnError', 'true',
    path.join(projectRoot, 'test-support', 'node-builtins.d.ts'),
    ...testEntries.map(entry => path.join(projectRoot, entry))
  ];
  console.info(`[test] Transpiling the test dependency graph with ${localCompiler ? 'local' : 'PATH'} TypeScript (deadline ${COMPILE_TIMEOUT_MS / 1000}s). Full type-checking is handled by npm run lint.`);
  const compile = localCompiler
    ? await run(process.execPath, [localCompiler, ...compileArgs], { timeoutMs: COMPILE_TIMEOUT_MS })
    : await run('tsc', compileArgs, { timeoutMs: COMPILE_TIMEOUT_MS });
  const compileFailure = describeFailure('Engine test transpilation', compile, COMPILE_TIMEOUT_MS);
  if (compileFailure) throw new Error(`${compileFailure}\n${compile.stdout}\n${compile.stderr}`);

  const compiledFiles = [];
  async function listJavaScript(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await listJavaScript(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.js')) compiledFiles.push(fullPath);
    }
  }
  await listJavaScript(outputRoot);
  const fileSet = new Set(compiledFiles.map(file => path.resolve(file)));
  for (const file of compiledFiles) {
    const source = await readFile(file, 'utf8');
    await writeFile(file, addNodeEsmExtensions(source, file, fileSet));
  }

  const compiledTests = testEntries.map(entry => path.join(outputRoot, entry.replace(/\.ts$/, '.js')));
  console.info(`[test] Transpiled ${testEntries.length} regression suites; executing with concurrency ${TEST_CONCURRENCY} and ${PER_TEST_TIMEOUT_MS} ms per-test timeout.`);
  const tests = await run(process.execPath, [
    '--test',
    `--test-concurrency=${TEST_CONCURRENCY}`,
    `--test-timeout=${PER_TEST_TIMEOUT_MS}`,
    '--test-force-exit',
    ...compiledTests
  ], { timeoutMs: TEST_PROCESS_TIMEOUT_MS, inherit: true, killProcessGroup: true });
  const testFailure = describeFailure('Regression tests', tests, TEST_PROCESS_TIMEOUT_MS);
  if (testFailure) throw new Error(testFailure);
  if (tests.status !== 0) process.exitCode = tests.status ?? 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
