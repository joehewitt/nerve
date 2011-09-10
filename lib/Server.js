
var express = require('express');
var fs = require('fs');
var path = require('path');
var jsdom = require('jsdom');
var _ = require('underscore');
var datetime = require('datetime');
var async = require('async');
var url = require('url');
var appjs = require('app.js');
var assert = require('assert').ok;
var cacheware = require('express-cache');
var rewriter = require('express-rewrite');
var logger = require('express-logger');
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
        async.map(configs,
            _.bind(function(config, cb2) {
                var blog = new Blog();
                this.blogs.push(blog);

                blog.init(config, options, _.bind(function(err, app) {
                    assert(!err, "Unable to load app " + JSON.stringify(config));

                    blog.api = new NerveAPI(blog, '/api');
                    blog.server = this.getServerForBlog(blog, options);
                    cb2(0, blog);
                }, this));
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
        server.rewrite = _.bind(rewriter.rewrite, server);

        server.configure(function() {
            server.use(rewriter);
            server.use(nerveMiddleware);
            server.use(express.query());
            server.use(express.bodyParser());
            if (blog.logsPath) {
                server.use(logger({path: blog.logsPath}));
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

        return server;
    }
};

// *************************************************************************************************

function nerveMiddleware(req, res, next) {
    res.setHeader('Date', new Date()+'');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Server', 'Nerve');
    next();    
}
