
var Blog = require('./Blog').Blog;
var Server = require('./Server').Server;

var defaultPort = 8080;

exports.Blog = Blog;

exports.run = function(argv) {
    var modulePaths = argv._[0].split(',');
    var contentPaths = argv.content ? argv.content.split(',') : [];
    var configName = argv.config;
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