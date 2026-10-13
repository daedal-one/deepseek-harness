// Private transport client. The owning application is always a dsh profile.
import { connect } from 'node:net';
const limit = 2 * 1024 * 1024;
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > limit) throw new Error('Verification packet exceeds budget');
}
const socket = connect(process.argv[2]);
const response = [];
let size = 0;
await new Promise((resolve, reject) => {
  socket.on('error', reject);
  socket.on('connect', () => socket.end(JSON.stringify({ directory: process.cwd(), packet: JSON.parse(input) })));
  socket.on('data', chunk => {
    size += chunk.length;
    if (size > limit) socket.destroy(new Error('Verification response exceeds budget'));
    else response.push(chunk);
  });
  socket.on('end', resolve);
});
const value = JSON.parse(Buffer.concat(response).toString('utf8'));
if (value.error) throw new Error(value.error);
process.stdout.write(JSON.stringify(value) + '\n');
