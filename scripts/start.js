const { spawn } = require('child_process');
const path = require('path');

const env = process.argv[2] || 'dev';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let scriptName = 'start:dev';
if (env === 'meta') {
    scriptName = 'start:meta';
}

const child = spawn(npm, ['run', scriptName], {
    stdio: 'inherit',
    shell: true
});

child.on('error', (error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});

child.on('close', (code) => {
    process.exit(code);
}); 