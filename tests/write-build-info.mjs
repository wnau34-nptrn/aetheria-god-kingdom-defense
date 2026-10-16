import { writeFile } from 'node:fs/promises';
if (!process.env.GITHUB_SHA) throw new Error('GITHUB_SHA is required when stamping a deployment');
await writeFile('dist/version.json', JSON.stringify({ commit:process.env.GITHUB_SHA, builtAt:new Date().toISOString() },null,2));
