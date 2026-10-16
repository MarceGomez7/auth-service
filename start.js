const { spawn } = require('node:child_process');
const path = require('node:path');

const services = ['orders-service.js', 'catalog-service.js', 'notifications-service.js'];
const children = services.map(file => spawn(process.execPath, [path.join(__dirname, 'modules', file)], { stdio: 'inherit', env: process.env }));
console.log('La identidad la administra Keycloak (docker compose), no un emisor local de tokens.');
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code, signal) => {
  if (!stopping && code !== 0) {
    console.error(`Uno de los servicios terminó (${signal || code}).`);
    stop(); process.exitCode = code || 1;
  }
});
