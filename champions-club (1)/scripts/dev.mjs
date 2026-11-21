import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const pyLibsDir = path.join(rootDir, '.pylibs');
const backendPort = process.env.BACKEND_PORT || '8001';

const existingPythonPath = process.env.PYTHONPATH
  ? `${pyLibsDir}${path.delimiter}${process.env.PYTHONPATH}`
  : pyLibsDir;

const pyEnv = {
  ...process.env,
  PYTHONUNBUFFERED: '1',
  PYTHONPATH: existingPythonPath,
};

function hasPythonDeps() {
  const res = spawnSync(
    'python3',
    ['-c', 'import fastapi, uvicorn, pydantic, jwt, bcrypt'],
    { env: pyEnv, stdio: 'ignore' }
  );
  return res.status === 0;
}

function ensurePythonDeps() {
  if (hasPythonDeps()) return true;
  console.log('[dev] Python dependencies missing in .pylibs; installing from requirements.txt...');
  fs.mkdirSync(pyLibsDir, { recursive: true });
  const bootstrap = `
set -e
if ! python3 -m pip --version >/dev/null 2>&1; then
  curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
  python3 /tmp/get-pip.py --break-system-packages --no-warn-script-location
  rm -f /tmp/get-pip.py
fi
python3 -m pip install --no-cache-dir --no-warn-script-location --target "${pyLibsDir}" -r requirements.txt
`;
  const installRes = spawnSync('bash', ['-c', bootstrap], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  return installRes.status === 0 && hasPythonDeps();
}

const viteBin = path.join(rootDir, 'node_modules', '.bin', 'vite');
const viteCmd = fs.existsSync(viteBin) ? viteBin : 'npx';
const viteArgs = fs.existsSync(viteBin)
  ? ['--port', '3000', '--host', '0.0.0.0']
  : ['vite', '--port', '3000', '--host', '0.0.0.0'];

const vite = spawn(viteCmd, viteArgs, {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env, BACKEND_PORT: backendPort },
});

let uvicorn = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (uvicorn) uvicorn.kill('SIGTERM');
  } catch {}
  try {
    vite.kill('SIGTERM');
  } catch {}
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

vite.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`Vite exited with code ${code}`);
    shutdown(code ?? 1);
  }
});

if (ensurePythonDeps()) {
  uvicorn = spawn(
    'python3',
    ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', backendPort],
    { cwd: rootDir, stdio: 'inherit', env: pyEnv }
  );

  uvicorn.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`FastAPI uvicorn exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });
} else {
  console.error('[dev] Failed to install Python dependencies from requirements.txt');
  shutdown(1);
}
