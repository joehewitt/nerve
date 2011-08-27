
var Blog = require('./Blog').Blog;
var Server = require('./Server').Server;
var assert = require('assert').ok;

var defaultPort = 8080;

exports.Blog = Blog;

exports.run = function(argv) {
    var modulePaths = argv._[0] ? argv._[0].split(',') : null;
    assert(modulePaths, "No module specified.");

    var configName = argv.config;

    if (argv.password) {
        var blog = new Blog(modulePaths[0]);
        blog.init(configName, argv, function(err, app) {
            blog.setPassword(argv.password);
        });
    } else {
        var contentPaths = argv.content ? argv.content.split(',') : [];
        var port = argv.port || defaultPort;

        var server = new Server();
        server.configure(modulePaths, contentPaths, configName, argv, function(err) {
            if (err) {
                console.error(err);
            } else {
                server.listen(port);
                console.log("Nerve server listening on port %d", server.server.address().port);
            }
        });        
    }
}