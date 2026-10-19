# pm2-elasticsearch-logger

[![License][mit-badge]][mit-url]

Send stdout and stderr from applications managed by [PM2](https://pm2.io) to Elasticsearch.

Maintained by [Teleflow](https://github.com/teleflowltd) for Node.js 26. Forked from [hobbyquaker/pm2-elasticsearch-logger](https://github.com/hobbyquaker/pm2-elasticsearch-logger).


## Install

Requires Node.js 26 or later and PM2 7 or later.

The first Teleflow release has not been published yet. Once it is available, install it directly from GitHub:

```sh
pm2 install https://github.com/teleflowltd/pm2-elasticsearch-logger/releases/latest/download/pm2-elasticsearch-logger.tgz
```

No clone or build is needed on the server. If PM2 is not installed, run `npm install -g pm2@7` under Node.js 26 or later first.

You can also download `pm2-elasticsearch-logger.tgz` from the [releases page](https://github.com/teleflowltd/pm2-elasticsearch-logger/releases) or copy a built package to the server, then install the file:

```sh
pm2 install /absolute/path/to/pm2-elasticsearch-logger.tgz
```

The package bundles its runtime dependencies so the security fixes also apply after PM2 installs it. PM2 registers it as `pm2-elasticsearch-logger` and starts it again when the daemon starts. Use the same operating-system user and `PM2_HOME` as the applications whose logs you want to collect.

Set your Elasticsearch URL and check the module's output:

```sh
pm2 set pm2-elasticsearch-logger:elasticUrl http://localhost:9200
pm2 logs pm2-elasticsearch-logger
```

`pm2 install pm2-elasticsearch-logger` installs the upstream npm package. Use the Teleflow release URL or package file to install this fork. `pm2 install .` enables PM2's development mode and file watching.


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

Run PM2 under Node.js 26 or later. If the running daemon uses an older Node.js or PM2 version, update it first:

```sh
npm install -g pm2@7
pm2 update
```

This restarts the applications managed by that daemon.

To update the installed Teleflow module to the latest published release, repeat the URL installation:

```sh
pm2 install https://github.com/teleflowltd/pm2-elasticsearch-logger/releases/latest/download/pm2-elasticsearch-logger.tgz
```

Existing module options are retained. To pin a release, replace `releases/latest/download` in the URL with `releases/download/v3.0.0` or the version you require.

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

Tests run with `--throw-deprecation` and cover HTTP/HTTPS forwarding, file watching, installation from a package URL and recovery after an isolated PM2 daemon restarts.

Keep `pmx: false` in the `apps` entry: this module initialises `@pm2/io` itself. PM2's preload can otherwise read PM2's package metadata instead of this module's configuration.

### Build a release package

From a checked-out copy of this repository:

```sh
nvm use
npm ci
npm audit
npm test
npm run package
```

This creates `dist/pm2-elasticsearch-logger.tgz` and its SHA-256 checksum in `dist/pm2-elasticsearch-logger.tgz.sha256`. Upload both files to a GitHub release tagged `v3.0.0` for this version. Keep the asset name `pm2-elasticsearch-logger.tgz` so the direct installation URL continues to work for subsequent releases.

Publishing a new npm name would require a separate npm release. A GitHub release package works with PM2 directly.


## License

MIT (c) 2019 Sebastian Raff

[mit-badge]: https://img.shields.io/badge/License-MIT-blue.svg?style=flat
[mit-url]: LICENSE
