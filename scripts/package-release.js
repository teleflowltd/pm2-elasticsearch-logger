const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
const destination = path.resolve(process.argv[2] || path.join(root, 'dist'));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pm2-es-release-'));

try {
    mkdirSync(destination, {recursive: true});
    const packed = execFileSync(process.execPath, [
        process.env.npm_execpath, 'pack', '--json', '--pack-destination', temporary
    ], {cwd: root, encoding: 'utf8'});
    const [{filename}] = JSON.parse(packed);
    const asset = `${pkg.name}.tgz`;
    const target = path.join(destination, asset);
    copyFileSync(path.join(temporary, filename), target);
    const checksum = createHash('sha256').update(readFileSync(target)).digest('hex');
    writeFileSync(`${target}.sha256`, `${checksum}  ${asset}\n`);
    console.log(`Created ${target}`);
    console.log(`SHA-256: ${checksum}`);
} finally {
    rmSync(temporary, {recursive: true, force: true});
}
