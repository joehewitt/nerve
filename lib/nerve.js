
var fs = require('fs');
var assert = require('assert').ok;
var Blog = require('./Blog').Blog;
var Server = require('./Server').Server;

var defaultPort = 8080;

exports.Blog = Blog;

exports.run = function(argv) {
    var configs = readConfig(argv);    

    if (argv.password) {
        configs.forEach(function(config) {
            var blog = new Blog();
            blog.init(config, argv, false, function(err, app) {
                blog.setPassword(argv.password);
            });
        });
    } else {
        var port = argv.port || defaultPort;

        var server = new Server();
        server.configure(configs, argv, function(err) {
            if (err) {
                console.error(err);
            } else {
                server.listen(port);
                console.log("Nerve server listening on port %d (%s)", server.server.address().port, new Date());
            }
        });        
    }
}

function readConfig(argv) {
    if (argv.config) {
        try {
            var content = fs.readFileSync(argv.config, 'utf8');
            var configs = JSON.parse(content);
            if (!(configs instanceof Array)) {
                configs = [configs];
            }
            configs.forEach(function(config) {
                assert(config.app, "No app module specified.");
                assert(config.content, "No content specified.");
                assert(config.vhost, "No vhost specified.");
                
                config.host = config.host || config.vhost;
                config.app = fixPath(config.app);
                config.content = fixPath(config.content);
                config.logs = fixPath(config.logs);
                config.caches = fixPath(config.caches);
            });
            return configs;
        } catch (exc) {
            console.error("Unable to read config at %s", configPath);
        }
    } else {
        var appPath = argv._[0];
        assert(appPath, "No app module specified.");
        assert(argv.content, "No content specified.");
        assert(argv.vhost, "No vhost specified.");

        return [{
            vhost: argv.vhost,
            host: argv.host || argv.vhost,
            cdn: argv.cdn,
            app: fixPath(appPath),
            content: fixPath(argv.content),
            logs: fixPath(argv.logs),
            caches: fixPath(argv.caches),
        }];
    }
}

function fixPath(thePath) {
    return thePath.replace(/^~/, process.env.HOME);
}
