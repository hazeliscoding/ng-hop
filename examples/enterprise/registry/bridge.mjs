// For Docker Engine on Linux only. The registry listens on 127.0.0.1, which a container can't reach there, since
// Linux has no Docker Desktop to lead host.docker.internal to it. This listens on Docker's bridge address, where the
// dev container's host.docker.internal points, and forwards to the registry. It never listens on every address, so
// nothing outside this machine's containers can reach the registry through it.
import { spawnSync } from 'node:child_process';
import { connect, createServer, isIPv4 } from 'node:net';

const asked = spawnSync('docker', ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8' });
const address = (asked.stdout || '').trim();
if (asked.status !== 0 || !isIPv4(address)) {
  console.error(`Could not read the address of Docker's bridge network: ${(asked.stderr || asked.error?.message || `docker answered "${address}"`).trim().split('\n')[0]}`);
  process.exit(1);
}

const server = createServer((client) => {
  const registry = connect(4873, '127.0.0.1');
  client.pipe(registry).pipe(client);
  for (const end of [client, registry]) end.on('error', () => { client.destroy(); registry.destroy(); });
});
server.on('error', (err) => { console.error(`Could not listen on ${address}:4873: ${err.message}`); process.exit(1); });
server.listen(4873, address, () => console.log(`Forwarding ${address}:4873 to the registry at 127.0.0.1:4873. Leave this running.`));
