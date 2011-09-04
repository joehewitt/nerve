
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
    configure: function(modulePaths, contentPaths, configName, options, cb) {
        assert(modulePaths.length == contentPaths.length,
               "Different number of apps and content supplied.");

        var i = 0;
        async.map(modulePaths,
            _.bind(function(modulePath, cb2) {
                modulePath = normalizePath(modulePath);
                var contentPath = normalizePath(contentPaths[i]);

                var blog = new Blog(modulePath, contentPath);
                blog.init(configName, options, true, _.bind(function(err, app) {
                    assert(!err, "Unable to load app at " + modulePath);

                    blog.api = new NerveAPI(blog, '/api');
                    blog.server = this.getServerForBlog(blog, options);

                    this.blogs.push(blog);
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
                if (!blog.hostName) {
                    throw new Exception("Blog requires a host name (" + blog.appPath + ")");
                }
                this.server.use(express.vhost(blog.hostName, blog.server));    
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
        blog.logStream = fs.createWriteStream(blog.logPath, {flags: 'a'});

        server.configure(function() {
            server.set('views', path.join(blog.appPath, 'views'));
            server.use(nerveMiddleware);
            server.use(express.query());
            server.use(express.bodyParser());
            server.use(express.logger({stream: blog.logStream}));
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
        var logDate = datetime.format(new Date(), '%Y-%m-%d');
        var ext = path.extname(blog.logPath);
        var name = path.basename(blog.logPath, ext);
        var dir = path.dirname(blog.logPath);
        var newPath = path.join(dir, name + '-' + logDate + ext);

        copyFile(blog.logPath, newPath, function(err) {
            if (!err) {
                fs.truncateSync(blog.logStream.fd, 0);
            } else {
                console.error("Unable to archive logs: " + err);
            }
        });
    }
};

// *************************************************************************************************

function nerveMiddleware(req, res, next) {
    res.setHeader('Date', new Date()+'');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Server', 'Nerve');
    next();    
}

function normalizePath(thePath) {
    // thePath = path.resolve(thePath);
    thePath = thePath.replace('~', process.env.HOME);
    return thePath;
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
