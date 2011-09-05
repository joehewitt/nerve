
var express = require('express');
var fs = require('fs');
var path = require('path');
var jsdom = require('jsdom');
var _ = require('underscore');
var datetime = require('datetime');
var async = require('async');
var url = require('url');
var appjs = require('appjs');
var assert = require('assert').ok;
var util = require('util');
var cacheware = require('diskcache').middleware;
var NerveAPI = require('./NerveAPI').NerveAPI;
var Blog = require('./Blog').Blog;
var syndicate = require('./syndicate');

// *************************************************************************************************

var debugMode = process.env.NODE_ENV != 'production';

// *************************************************************************************************

function Server() {
    this.blogs = [];
}
exports.Server = Server;

Server.prototype = {
    configure: function(configs, options, cb) {
        var i = 0;
        async.map(configs,
            _.bind(function(config, cb2) {
                var blog = new Blog();
                this.blogs.push(blog);

                blog.init(config, options, true, _.bind(function(err, app) {
                    assert(!err, "Unable to load app " + JSON.stringify(config));

                    blog.api = new NerveAPI(blog, '/api');
                    blog.server = this.getServerForBlog(blog, options);
                    cb2(0, blog);
                }, this));
                ++i;
            }, this),
            _.bind(function(err, blogs) {
                cb(err);
            }, this)
        );
    },

    listen: function(port) {
        if (this.server) {
            this.server.stop();
        }

        if (this.blogs.length == 1) {
            this.server = this.blogs[0].server;
        } else {
            this.server = express.createServer();

            for (var i = 0; i < this.blogs.length; ++i) {
                var blog = this.blogs[i];
                if (!blog.vhost) {
                    throw new Exception("Blog requires a host name (" + blog.appPath + ")");
                }
                this.server.use(express.vhost(blog.vhost, blog.server));    
            }            

            this.server.use(this.server.router);
            this.server.get("*", function(req, res) {
                res.send('Nothing to see here.', {'Content-Type': 'text/plain'}, 200);
            });
        }

        this.server.listen(port);
    },

    getServerForBlog: function(blog, options) {
        var server = express.createServer();
        
        server.configure(function() {
            server.use(nerveMiddleware);
            server.use(express.query());
            server.use(express.bodyParser());

            if (blog.logsPath) {
                blog.logStream = fs.createWriteStream(blog.logsPath, {flags: 'a'});
                server.use(express.logger({stream: blog.logStream}));
            }

            server.use(server.router);
        });

        server.configure('development', function() {
            server.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
        });

        server.configure('production', function() {
            server.use(express.errorHandler()); 
        });

        blog.configure(server);

        var middleware = options.disableCache ? null : [cacheware(blog.cache)];

        syndicate.route(server, blog, middleware);
        blog.api.route(server, middleware);
        appjs.route(server, blog.app, blog.api, blog.cache, options || {});

        // Archive the logs every 24 hours
        blog.logArchiveInterval = setInterval(_.bind(function() {
            this.archiveLogs(blog);
        }, this), 60*60*24*1000);
        return server;
    },

    archiveLogs: function(blog) {
        if (blog.logsPath) {
            var logDate = datetime.format(new Date(), '%Y-%m-%d');
            var ext = path.extname(blog.logsPath);
            var name = path.basename(blog.logsPath, ext);
            var dir = path.dirname(blog.logsPath);
            var newPath = path.join(dir, name + '-' + logDate + ext);

            copyFile(blog.logsPath, newPath, function(err) {
                if (!err) {
                    fs.truncateSync(blog.logStream.fd, 0);
                } else {
                    console.error("Unable to archive logs: " + err);
                }
            });
        }
    }
};

// *************************************************************************************************

function nerveMiddleware(req, res, next) {
    res.setHeader('Date', new Date()+'');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Server', 'Nerve');
    next();    
}

function copyFile(src, dst, cb) {
    fs.stat(dst, function(err) {
        if (!err) { cb(new Error(dst + " already exists.")); return; }

        fs.stat(src, function (err) {
            if (err) { cb(err); return }

            var is = fs.createReadStream(src);
            var os = fs.createWriteStream(dst);
            util.pump(is, os, cb);
      });
    });
}

// facebookComments: function(url) {
//     return '<div id="fb-root"></div>'
//         + '<script src="http://connect.facebook.net/en_US/all.js#appId='
//         + blog.facebookAppId+'&amp;xfbml=1">'
//         + '</script><fb:comments href="'+url+'" num_posts="2" width="352"></fb:comments>';
// },

// facebookCommentCount: function(url) {
//     return '<div id="fb-root"></div>' 
//         + '<script src="http://connect.facebook.net/en_US/all.js#appId='
//         + blog.facebookAppId+'&amp;xfbml=1">'
//         + '</script><fb:comments-count href="'+url+'"></fb:comments-count>';
// }
