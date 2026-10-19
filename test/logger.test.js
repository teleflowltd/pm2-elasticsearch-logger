const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {EventEmitter, once} = require('node:events');
const {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const {after, before, test} = require('node:test');
const {promisify} = require('node:util');
const start = require('../index.js');

function initialise(t, conf = {}, {initError, busError} = {}) {
    const bus = new EventEmitter();
    const pm2 = {launchBus: t.mock.fn(callback => callback(busError, bus))};
    const io = {initModule: t.mock.fn((options, callback) => callback(initError, conf))};
    const reported = Promise.withResolvers();
    const errors = t.mock.method(console, 'error', (...args) => reported.resolve(args));
    const logs = t.mock.method(console, 'log', () => {});
    start(io, pm2);
    return {bus, pm2, errors, logs, errorReported: reported.promise};
}

async function receiveLogs(t, {tls, status = 201, respond = true} = {}) {
    const received = new EventEmitter();
    const server = (tls ? https : http).createServer(tls || {}, async (request, response) => {
        let body = '';
        for await (const chunk of request) {
            body += chunk;
        }
        if (respond) {
            response.writeHead(status).end();
        }
        received.emit('document', {
            method: request.method,
            url: request.url,
            headers: request.headers,
            body: JSON.parse(body)
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
    }));
    return {server, received, url: `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}`};
}

const message = {
    process: {pm_id: 4, name: 'example-app'},
    data: 'Log message: £ ☕\n'
};

test('forwards stdout and stderr with the existing URL and document format', async t => {
    const now = new Date(2026, 0, 15, 12);
    t.mock.timers.enable({apis: ['Date'], now: now.valueOf()});
    const receiver = await receiveLogs(t);
    const {bus, errors} = initialise(t, {elasticUrl: receiver.url});

    for (const [event, source] of [['log:out', 'stdout'], ['log:err', 'stderr']]) {
        const pending = once(receiver.received, 'document');
        bus.emit(event, message);
        const [request] = await pending;
        assert.equal(request.method, 'POST');
        assert.equal(request.url, '/pm2-2026.01.15/pm2/');
        assert.equal(request.headers['content-type'], 'application/json');
        assert.equal(Number(request.headers['content-length']), Buffer.byteLength(JSON.stringify(request.body)));
        assert.deepEqual(request.body, {
            '@timestamp': now.toISOString(),
            host: os.hostname(),
            source,
            id: 4,
            process: 'example-app',
            message: message.data
        });
    }
    assert.equal(errors.mock.callCount(), 0);
});

test('preserves base paths, credentials and custom document options', async t => {
    t.mock.timers.enable({apis: ['Date'], now: new Date(2026, 0, 15, 12).valueOf()});
    const receiver = await receiveLogs(t);
    const elasticUrl = receiver.url.replace('://', '://user:password@') + '/elastic/';
    const {bus, logs} = initialise(t, {elasticUrl, index: 'apps', type: '_doc', host: 'log-host'});
    const pending = once(receiver.received, 'document');
    bus.emit('log:out', message);
    const [request] = await pending;
    assert.equal(request.url, '/elastic/apps-2026.01.15/_doc/');
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('user:password').toString('base64')}`);
    assert.equal(request.body.host, 'log-host');
    assert.doesNotMatch(JSON.stringify(logs.mock.calls), /user|password/);
});

test('rotates the index even when the next log has the same day in another month or year', async t => {
    t.mock.timers.enable({apis: ['Date'], now: 0});
    const receiver = await receiveLogs(t);
    const {bus} = initialise(t, {elasticUrl: receiver.url});
    for (const [year, month, date] of [[2026, 0, 15], [2026, 1, 15], [2027, 1, 15]]) {
        t.mock.timers.setTime(new Date(year, month, date, 12).valueOf());
        const pending = once(receiver.received, 'document');
        bus.emit('log:out', message);
        const [request] = await pending;
        assert.equal(request.url, `/pm2-${year}.${String(month + 1).padStart(2, '0')}.15/pm2/`);
    }
});

test('ignores its own logs to avoid a forwarding loop', t => {
    const request = t.mock.method(http, 'request', () => assert.fail('self logs must not be forwarded'));
    const {bus} = initialise(t);
    const self = {...message, process: {pm_id: 1, name: 'pm2-elasticsearch-logger'}};
    bus.emit('log:out', self);
    bus.emit('log:err', self);
    assert.equal(request.mock.callCount(), 0);
});

test('stops when module initialisation fails', async t => {
    const {pm2, errorReported} = initialise(t, undefined, {initError: new Error('initialisation failed')});
    assert.deepEqual(await errorReported, ['error on initialising module', 'initialisation failed']);
    assert.equal(pm2.launchBus.mock.callCount(), 0);
});

test('stops when the PM2 bus cannot be launched', async t => {
    const {bus, errorReported} = initialise(t, {}, {busError: new Error('bus unavailable')});
    assert.deepEqual(await errorReported, ['error on launching PM2 bus', 'bus unavailable']);
    assert.equal(bus.eventNames().length, 0);
});

for (const elasticUrl of ['not a URL', 'ftp://localhost:9200']) {
    test(`rejects an invalid Elasticsearch URL: ${elasticUrl}`, async t => {
        const {pm2, errorReported} = initialise(t, {elasticUrl});
        assert.equal((await errorReported)[0], 'error on configuring Elasticsearch');
        assert.equal(pm2.launchBus.mock.callCount(), 0);
    });
}

for (const status of [401, 500]) {
    test(`reports Elasticsearch HTTP ${status} errors`, async t => {
        const receiver = await receiveLogs(t, {status});
        const {bus, errorReported} = initialise(t, {elasticUrl: receiver.url});
        bus.emit('log:out', message);
        const error = await errorReported;
        assert.equal(error[0], 'error on sending log message');
        assert.match(error[1], new RegExp(`HTTP ${status}`));
    });
}

test('reports connection failures without throwing from the bus handler', async t => {
    const receiver = await receiveLogs(t, {respond: false});
    receiver.server.on('request', request => request.socket.destroy());
    const {bus, errorReported} = initialise(t, {elasticUrl: receiver.url});
    bus.emit('log:out', message);
    assert.match((await errorReported)[1], /socket hang up|ECONNRESET/);
});

test('aborts requests that do not complete within the timeout', async t => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', milliseconds => {
        assert.equal(milliseconds, 10_000);
        return timeout(50);
    });
    const receiver = await receiveLogs(t, {respond: false});
    const {bus, errorReported} = initialise(t, {elasticUrl: receiver.url});
    bus.emit('log:out', message);
    assert.match((await errorReported)[1], /aborted/i);
});

const certificateDirectory = mkdtempSync(path.join(os.tmpdir(), 'pm2-es-tls-'));
let tls;
after(() => rmSync(certificateDirectory, {recursive: true, force: true}));
before(async () => {
    const key = path.join(certificateDirectory, 'key.pem');
    const cert = path.join(certificateDirectory, 'cert.pem');
    await promisify(execFile)('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-noenc',
        '-keyout', key, '-out', cert, '-days', '1',
        '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    ]);
    tls = {key: readFileSync(key), cert: readFileSync(cert)};
});

for (const insecure of [undefined, false, 'false']) {
    test(`verifies HTTPS certificates when insecure is ${JSON.stringify(insecure)}`, async t => {
        const receiver = await receiveLogs(t, {tls});
        const {bus, errorReported} = initialise(t, {elasticUrl: receiver.url, insecure});
        bus.emit('log:out', message);
        assert.match((await errorReported)[1], /self.signed certificate/i);
    });
}

for (const insecure of [true, 'true']) {
    test(`allows a self-signed HTTPS certificate when insecure is ${JSON.stringify(insecure)}`, async t => {
        const receiver = await receiveLogs(t, {tls});
        const {bus, errors} = initialise(t, {elasticUrl: receiver.url, insecure});
        const pending = once(receiver.received, 'document');
        bus.emit('log:out', message);
        const [request] = await pending;
        assert.equal(request.body.message, message.data);
        assert.equal(errors.mock.callCount(), 0);
    });
}

test('forwards real PM2 process logs without deprecated APIs', {timeout: 30_000}, async t => {
    const receiver = await receiveLogs(t);
    const pm2Home = mkdtempSync(path.join(os.tmpdir(), 'pm2-es-test-'));
    const root = path.resolve(__dirname, '..');
    const command = path.join(root, 'node_modules/pm2/bin/pm2');
    const env = {
        ...process.env,
        PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
        PM2_HOME: pm2Home,
        PM2_SILENT: 'true',
        PM2_DISABLE_INTERACTION: 'true',
        PM2_SECRET_KEY: '',
        PM2_PUBLIC_KEY: '',
        NODE_OPTIONS: '--throw-deprecation'
    };
    const run = args => promisify(execFile)(process.execPath, [command, ...args], {
        cwd: root,
        env,
        timeout: 15_000
    });
    let finished = false;
    t.after(async () => {
        try {
            await run(['kill']);
        } finally {
            const logDirectory = path.join(pm2Home, 'logs');
            if (!finished && existsSync(logDirectory)) {
                for (const filename of readdirSync(logDirectory)) {
                    if (filename.startsWith('pm2-elasticsearch-logger')) {
                        t.diagnostic(readFileSync(path.join(logDirectory, filename), 'utf8').slice(-2000));
                    }
                }
            }
            rmSync(pm2Home, {recursive: true, force: true});
        }
    });

    await run(['set', 'pm2-elasticsearch-logger:elasticUrl', receiver.url]);
    const {stdout: packed} = await promisify(execFile)('npm', ['pack', '--json', '--pack-destination', pm2Home], {
        cwd: root,
        env,
        timeout: 15_000
    });
    const tarball = path.join(pm2Home, JSON.parse(packed)[0].filename);
    await run(['install', tarball]);
    const {stdout: listed} = await run(['jlist']);
    const installed = JSON.parse(listed).find(app => app.name === 'pm2-elasticsearch-logger');
    assert.equal(installed.pm2_env.status, 'online');
    assert.equal(installed.pm2_env.pmx_module, true);
    const dependencyDirectory = path.join(pm2Home, 'modules', 'pm2-elasticsearch-logger', 'node_modules', 'pm2-elasticsearch-logger', 'node_modules');
    for (const name of Object.keys(require('../package.json').overrides)) {
        const version = require('../package-lock.json').packages[`node_modules/${name}`].version;
        const pkg = JSON.parse(readFileSync(path.join(dependencyDirectory, name, 'package.json'), 'utf8'));
        assert.equal(pkg.version, version, `${name} must retain its patched version after installation`);
    }
    await run(['kill']);
    await run(['ping']);
    const {stdout: relaunched} = await run(['jlist']);
    assert.equal(JSON.parse(relaunched).find(app => app.name === 'pm2-elasticsearch-logger').pm2_env.status, 'online');
    const emitter = path.join(pm2Home, 'emitter.js');
    writeFileSync(emitter, "setInterval(() => { console.log('Node ' + process.version); console.error('PM2 stderr'); }, 100);\n");
    const documents = new Map();
    const forwarded = Promise.withResolvers();
    receiver.received.on('document', ({body}) => {
        if (body.process === 'node26-test') {
            documents.set(body.source, body);
            if (documents.has('stdout') && documents.has('stderr')) {
                forwarded.resolve();
            }
        }
    });
    await run(['start', emitter, '--name', 'node26-test', '--no-autorestart', '--interpreter', process.execPath]);
    await forwarded.promise;
    assert.equal(documents.get('stdout').message.trim(), `Node ${process.version}`);
    assert.match(documents.get('stderr').message, /^PM2 stderr/);
    for (const filename of readdirSync(path.join(pm2Home, 'logs'))) {
        const content = readFileSync(path.join(pm2Home, 'logs', filename), 'utf8');
        assert.doesNotMatch(content, /DeprecationWarning|DEP0060/);
    }
    finished = true;
});

test('PM2 restarts a watched file with the upgraded Chokidar', {timeout: 5000}, async t => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'pm2-es-watch-'));
    const filename = path.join(directory, 'app.js');
    writeFileSync(filename, 'before\n');
    const restarted = Promise.withResolvers();
    const god = {
        restartProcessName(name, callback) {
            assert.equal(name, 'watch-test');
            restarted.resolve();
            callback(null, []);
        }
    };
    t.mock.method(console, 'log', () => {});
    require('../node_modules/pm2/lib/Watcher.js')(god);
    god.watch.enable({pm_id: 0, name: 'watch-test', watch: [filename], pm_cwd: directory});
    const watcher = god.watch._watchers[0];
    t.after(async () => {
        await watcher.close();
        rmSync(directory, {recursive: true, force: true});
    });
    await once(watcher, 'ready');
    // Allow macOS to finish attaching its native file notification handler.
    await new Promise(resolve => setTimeout(resolve, 100));
    writeFileSync(filename, 'after\n');
    await restarted.promise;
});
