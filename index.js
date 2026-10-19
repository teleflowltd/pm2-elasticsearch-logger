const os = require('node:os');
const http = require('node:http');
const https = require('node:https');

function start(io, pm2) {
    io.initModule({}, (error, conf) => {
        if (error) {
            console.error('error on initialising module', error.message);
            return;
        }

        const config = {
            index: conf.index || 'pm2',
            type: conf.type || 'pm2',
            host: conf.host || os.hostname(),
            elasticUrl: conf.elasticUrl || 'http://localhost:9200',
            insecure: conf.insecure === true || conf.insecure === 'true'
        };

        let elasticUrl;
        try {
            elasticUrl = new URL(config.elasticUrl);
            if (!['http:', 'https:'].includes(elasticUrl.protocol)) {
                throw new Error('elasticUrl must use HTTP or HTTPS');
            }
        } catch (error) {
            console.error('error on configuring Elasticsearch', error.message);
            return;
        }

        let url;
        let currentDate;

        function reportError(error) {
            console.error('error on sending log message', error.message || error.code);
        }

        function log(source, msg) {
            const now = new Date();
            const date = [
                now.getFullYear(),
                String(now.getMonth() + 1).padStart(2, '0'),
                String(now.getDate()).padStart(2, '0')
            ].join('.');

            if (date !== currentDate) {
                url = new URL(elasticUrl);
                url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(`${config.index}-${date}`)}/${encodeURIComponent(config.type)}/`;
                console.log('sending logs to', url.origin + url.pathname);
                currentDate = date;
            }

            const body = JSON.stringify({
                '@timestamp': now.toISOString(),
                host: config.host,
                source,
                id: msg.process.pm_id,
                process: msg.process.name,
                message: msg.data
            });

            const transport = url.protocol === 'https:' ? https : http;
            const request = transport.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                rejectUnauthorized: !config.insecure,
                signal: AbortSignal.timeout(10_000)
            }, response => {
                response.on('error', reportError);
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reportError(new Error(`HTTP ${response.statusCode} ${response.statusMessage}`));
                }
                response.resume();
            });

            request.on('error', reportError);
            request.end(body);
        }

        pm2.launchBus((error, bus) => {
            if (error) {
                console.error('error on launching PM2 bus', error.message);
                return;
            }

            bus.on('log:err', data => {
                if (data.process.name !== 'pm2-elasticsearch-logger') {
                    log('stderr', data);
                }
            });

            bus.on('log:out', data => {
                if (data.process.name !== 'pm2-elasticsearch-logger') {
                    log('stdout', data);
                }
            });
        });
    });
}

module.exports = start;

if (require.main === module) {
    start(require('@pm2/io'), require('pm2'));
}
