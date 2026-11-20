// Run the fake server by hand: `node test/fake-server/cli.ts [--port 8790] [--key test-device-key]`, then
// `npm run dev` and add the server in Hearth with the address and key it prints. Prompts pick a script with a tag:
// #subagent, #permission, #plan-and-edits, #long, #drop, #never, #error, #elsewhere, #fallback (anything else: a short hello).
import { startFakeServer } from './server.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const fake = await startFakeServer({ port: Number(arg('port') ?? 8790), ...(arg('key') ? { key: arg('key') } : {}) });
console.log(`Fake Hearth server on ${fake.url}\nDevice key: ${fake.key}`);
process.on('SIGINT', () => { void fake.close().then(() => process.exit(0)); });
