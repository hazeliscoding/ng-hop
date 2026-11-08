// The company registry runs on the host at localhost:4873, which inside the container is the container itself. This
// forwards the container's localhost:4873 to the host, so .npmrc can name one address for both.
import { connect, createServer } from 'node:net';

const server = createServer((client) => {
  const host = connect(4873, 'host.docker.internal');
  client.pipe(host).pipe(client);
  for (const end of [client, host]) end.on('error', () => { client.destroy(); host.destroy(); });
});
server.on('error', (err) => {
  // Already forwarding, from an earlier start.
  if (err.code === 'EADDRINUSE') process.exit(0);
  throw err;
});
server.listen(4873, '127.0.0.1');
