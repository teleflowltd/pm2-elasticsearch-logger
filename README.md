# pm2-elasticsearch-logger

[![License][mit-badge]][mit-url]

Send stdout and stderr from applications managed by [PM2](https://pm2.io) to Elasticsearch.

Maintained by [Teleflow](https://github.com/teleflow) for Node.js 26. Forked from [hobbyquaker/pm2-elasticsearch-logger](https://github.com/hobbyquaker/pm2-elasticsearch-logger).


## Install

Requires Node.js 26 or later and PM2 7 or later.

Clone the Teleflow fork, select Node.js 26, then build and install the module:

```sh
git clone https://github.com/teleflow/pm2-elasticsearch-logger.git
cd pm2-elasticsearch-logger
nvm install 26
npm ci
npm pack
npx --no-install pm2 install "$PWD/pm2-elasticsearch-logger-2.0.0.tgz"
```

`nvm install 26` also selects that Node.js version for the current shell. If you manage Node.js another way, ensure `node --version` reports version 26 or later. `npx --no-install` uses the PM2 version installed in this checkout.

The package bundles its runtime dependencies so the security fixes also apply after PM2 installs it. PM2 installs a separate copy and registers it as a module, which starts again when the PM2 daemon starts. Use the same operating-system user and `PM2_HOME` as the applications whose logs you want to collect.

Set your Elasticsearch URL and check the module's output:

```sh
npx --no-install pm2 set pm2-elasticsearch-logger:elasticUrl http://localhost:9200
npx --no-install pm2 logs pm2-elasticsearch-logger
```

Installing `pm2-elasticsearch-logger` by name downloads the npm release, which does not include this checkout's unpublished changes. Install the package built from this repository to use the Teleflow fork. `pm2 install .` is PM2's development mode and enables file watching, so use the packaged installation above for deployment.


## Configuration

Set options with the command

`pm2 set pm2-elasticsearch-logger:<option> <value>`

PM2 will automatically restart the module after changing an option.

#### Options

| option |           | default |
| ------ | --------- | ------- |
| elasticUrl | URL of Elasticsearch API | `http://localhost:9200` |
| insecure | allow https connections to servers with invalid certificate | `false` |
| index | Elasticsearch index to use | `pm2` |
| type | Document type to use | `pm2` |
| host | `host` attribute of the document | `os.hostname()` |

Logs are sent to `<elasticUrl>/<index>-YYYY.MM.DD/<type>/`, using the server's local date for the index and an ISO UTC timestamp in each document. Existing options and document fields are preserved.

HTTP and HTTPS are supported, including basic authentication in `elasticUrl`. Certificate verification is enabled unless `insecure` is `true`. Requests time out after 10 seconds; connection errors and non-success HTTP responses are written to the module's error log. Failed requests are not retried.

### Updating an existing installation

Run PM2 under Node.js 26 or later. If the running daemon uses an older Node.js or PM2 version, update it using this checkout's PM2:

```sh
npx --no-install pm2 update
```

This restarts the applications managed by that daemon.

To update the installed Teleflow module, run these commands from your clone:

```sh
git pull --ff-only
nvm use
npm ci
npm pack
npx --no-install pm2 install "$PWD/pm2-elasticsearch-logger-2.0.0.tgz"
```

Existing module options are retained.

### Dependency security fixes

The latest PM2 release pins older dependencies. This package overrides `basic-ftp` to 6.2.3, `js-yaml` to 4.3.2 and Chokidar to 5.0.0, removing the vulnerable `braces` dependency. `npm audit` runs in CI.

Inside PM2's installed module directory, `npm ls` can label these bundled versions `invalid` because PM2's own manifest still requests the older versions. The installation test checks that the fixed versions are retained, and `npm audit` checks those installed versions.

Chokidar 5 accepts file and directory paths instead of glob patterns. If you use this checkout's PM2 daemon for other applications, use paths in `watch` and paths or regular expressions in `ignore_watch`. The packaged logger has file watching disabled.

## Todo, Ideas

* Configurable document attributes
* Create mapping for `@timestamp` only if neccessary, control by config option


## Contributing

Pull Requests welcome!

Use `nvm use`, then `npm ci` and `npm test`. Tests require OpenSSL 3 or later and generate temporary HTTPS certificates, which are deleted afterwards. PEM files are ignored by Git.

Tests run with `--throw-deprecation` and cover HTTP/HTTPS forwarding, file watching, packaged installation and recovery after an isolated PM2 daemon restarts.

Keep `pmx: false` in the `apps` entry: this module initialises `@pm2/io` itself. PM2's preload can otherwise read PM2's package metadata instead of this module's configuration.


## License

MIT (c) 2019 Sebastian Raff

[mit-badge]: https://img.shields.io/badge/License-MIT-blue.svg?style=flat
[mit-url]: LICENSE
