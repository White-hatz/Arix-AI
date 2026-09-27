const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const winVenv = path.join(root, '.venv', 'Scripts', 'python.exe');
const unixVenv = path.join(root, '.venv', 'bin', 'python');

let pythonBin = 'python';
if (process.platform === 'win32' && fs.existsSync(winVenv)) {
  pythonBin = winVenv;
} else if (fs.existsSync(unixVenv)) {
  pythonBin = unixVenv;
}

const args = process.argv.slice(2);
const child = spawn(pythonBin, args, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PYTHONPATH: root,
  },
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

child.on('error', (err) => {
  console.error('[run-python] Failed to start Python process:', err);
  process.exit(1);
});
