#!/usr/bin/env node
// Self-contained hook — reads stdin JSON, returns empty result.
// Full handler logic requires building the TypeScript source first:
//   cd plugin/claude-code && pnpm build
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  try {
    // Hook input available as: JSON.parse(data)
    process.stdout.write(JSON.stringify({}));
  } catch {
    process.stdout.write(JSON.stringify({}));
  }
});
process.stdin.resume();
