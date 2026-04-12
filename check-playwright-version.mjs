import fs from 'node:fs';
import process from 'node:process';

function readFile(path) {
    return fs.readFileSync(path, 'utf8');
}

const dockerfile = readFile('Dockerfile');
const packageJson = JSON.parse(readFile('package.json'));

const imageMatch = dockerfile.match(/actor-node-playwright-[^:\s]+:\d+-([0-9]+\.[0-9]+\.[0-9]+)/);
const imagePlaywrightVersion = imageMatch?.[1];
const packagePlaywrightVersion = String(packageJson?.dependencies?.playwright ?? '').replace(/^[~^]/, '');

if (!imagePlaywrightVersion) {
    process.stdout.write('Could not detect Playwright version from Docker image tag. Skipping strict check.\n');
    process.exit(0);
}

if (!packagePlaywrightVersion) {
    process.stderr.write('Missing `dependencies.playwright` in package.json.\n');
    process.exit(1);
}

if (imagePlaywrightVersion !== packagePlaywrightVersion) {
    process.stderr.write(
        `Playwright version mismatch: Docker image uses ${imagePlaywrightVersion}, package.json uses ${packagePlaywrightVersion}.\n`,
    );
    process.exit(1);
}

process.stdout.write(`Playwright version check passed (${packagePlaywrightVersion}).\n`);
