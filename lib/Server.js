
var express = require('express');
var fs = require('fs');
var path = require('path');
var Step = require('step');
var jsdom = require('jsdom');
var _ = require('underscore');
var datetime = require('datetime');
var async = require('async');
var url = require('url');
var appjs = require('appjs');
var Blog = require('./Blog').Blog;
var assert = require('assert').ok;
var dandy = require('dandy/errors');
var abind = dandy.abind;

// *************************************************************************************************

var defaultPort = 8080;
var jsonMimeType = 'application/x-javascript';
var htmlMimeType = 'text/html';
var rssMimeType = 'application/rss+xml';

var rePostFileName = /(\d{4})-(\d{2})-(\d{2}).(md|markdown)/;

var debugMode = process.env.NODE_ENV != 'production';

// *************************************************************************************************

function Server() {
    this.blogs = [];
}
exports.Server = Server;

Server.prototype = {
    configure: function(modulePaths, contentPaths, configName, options, cb) {
        assert(modulePaths.length == contentPaths.length, "Different number of apps and content supplied.");

        var i = 0;
        async.map(modulePaths,
            _.bind(function(modulePath, cb2) {
                modulePath = normalizePath(modulePath);
                var contentPath = normalizePath(contentPaths[i]);
                
                appjs.loadApp(modulePath, configName, options, _.bind(function(err, app) {
                    assert(!err, "Unable to load app at " + modulePath);

                    var debugConfig = process.env.NODE_ENV ||  "development";
                    var configNames = [debugConfig, app.configName]
                    var settings = readSettings(app.packageInfo.nerve, {}, configNames);
                    
                    var blog = new Blog(modulePath, contentPath, settings);
                    blog.app = app;
                    this.addBlog(blog);

                    blog.server = this.getServerForBlog(blog);
                    this.monitorBlog(blog);
                    cb2(0, blog);
                }, this));
                ++i;
            }, this),
            _.bind(function(err, blogs) {
                cb(err);
            }, this)
        );
    },

    addBlog: function(blog) {
        this.blogs.push(blog);
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
        }

        this.server.listen(port);
    },

    renderCachedPage: function(blog, fn, category, mimeType) {
        return _.bind(function(req, res) {
            try {
                // Comment out to disable caching
                return fn(req, res, category, function(err, entry) {
                    if (err) {
                        sendError(req, res, mimeType, err);
                    } else {
                        sendPage(req, res, false, entry);
                    }
                });

                var url = blog.normalizeURL(req.url);
                blog.diskCache.load(url, category, _.bind(function(err, entry) {
                    if (err || !entry || !entry.body.length) {
                        blog.diskCache.lock(url);
                        fn(req, res, category, _.bind(function(err, entry) {
                            if (err) {
                                sendError(req, res, mimeType, err);
                            } else {
                                this.cachePage(url, entry, blog, category, function(err, entry) {
                                    sendPage(req, res, true, entry);
                                });                            
                            }
                        }, this));
                    } else {
                        sendPage(req, res, true, entry);
                    }
                }, this));
            } catch (exc) {
                sendError(req, res, mimeType, exc);
            }
        }, this);
    },

    cachePage: function(url, entry, blog, category, cb) {
        blog.diskCache.store(url, entry, category, function(err) {
            if (cb) cb(0, entry);
        });
    },

    uncachePage: function(url, blog, category) {
        blog.diskCache.remove(url, category);
    },

    resetPageCache: function(blog, category) {
        blog.diskCache.removeAll(category);
    },

    postModified: function(post) {
        console.log('MODIFIED ', post.title);
        if (post.isChronological) {
            this.uncachePage(post.url, post.blog, 'post');
            this.resetPageCache(post.blog, 'index');
        } else {
            if (post.group == 'drafts') {
                this.resetPageCache(post.blog, 'drafts');
            } else {
                this.uncachePage(post.url, post.blog, 'post');
            }
        }
    },

    monitorBlog: function(blog) {
        blog.on('postCreated', _.bind(this.postModified, this));
        blog.on('postChanged', _.bind(this.postModified, this));
        blog.on('postDeleted', _.bind(this.postModified, this));
    },

    getServerForBlog: function(blog) {
        var server = express.createServer();
        var logStream = fs.createWriteStream(blog.logPath, {flags: 'a'});

        server.configure(function() {
            server.set('views', path.join(blog.appPath, 'views'));
            server.use(express.bodyParser());
            server.use(express.logger({stream: logStream}));
            server.use(server.router);
        });

        server.configure('development', function() {
            server.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
        });

        server.configure('production', function() {
            server.use(express.errorHandler()); 
        });

        this.addRoutesForBlog(server, blog);
        appjs.configure(server, blog.app, {});

        return server;
    },

    addRoutesForBlog: function(app, blog) {
        app.get('/api/page/:page',
                this.renderCachedPage(blog, indexPage, 'post', jsonMimeType));
        app.get('/api/group/:name',
                this.renderCachedPage(blog, groupPage, 'post', jsonMimeType));
        app.get('/api/post/:year/:month/:day/:id',
                this.renderCachedPage(blog, postPage, 'post', jsonMimeType));
        app.get('/rss.xml',
                this.renderCachedPage(blog, rssPage, 'index', rssMimeType));

        function indexPage(req, res, category, cb) {
            var pageNum = req.params.page ? parseInt(req.params.page)-1 : 0;
            renderJSONPosts(req, res, pageNum, category, function() {
                blog.getPostsByPage(pageNum, blog.postsPerPage, true, this);
            }, cb);
        }

        function groupPage(req, res, category, cb) {
            renderJSONPosts(req, res, 0, category, function() {
                blog.getPostsByGroup(req.params.name, true, this);
            }, cb);
        }

        function postPage(req, res, category, cb) {
            renderJSONPosts(req, res, 0, category, function() {
                blog.getPost(req.params.id, req.params.year, req.params.month, req.params.day,
                             true, this);
            }, cb);
        }

        function rssPage(req, res, category, cb) {
            blog.getPostsByPage(0, blog.postsPerPage, true, function(err, posts) {
                if (err) {
                    cb(err);
                    return;
                }

                var rss =
                    '<?xml version="1.0" encoding="utf-8" ?>'+
                    '<rss version="2.0">'+
                    '<channel>'+
                        '<title>' + blog.title + '</title>'+
                        '<link>' + blog.link + '</link>'+
                        _.map(posts, function(post) {
                            return ''+
                                '<item>'+
                                '<title>' + post.title + '</title>'+
                                '<description><![CDATA[' + renderRSSBody(post) + ']]></description>'+
                                '<link>' + post.url + '</link>'+
                                '<pubDate>' + post.date + '</pubDate>'+
                                '</item>';
                        }).join('\n')+
                    '</channel>'+
                    '</rss>';
                cb(0, {mimeType: rssMimeType, body: rss});
            });
        }

        function renderJSONPosts(req, res, pageNum, category, fn, cb) {
            Step(
            fn,
            abind(function(err, posts) {
                if (!posts.length) {
                    cb(new Error("Not found"));
                } else {
                    var clientPosts = postsForClient(posts);
                    var jsonBody = JSON.stringify(clientPosts);
                    var URL = url.parse(req.url, true);
                    jsonBody = (URL.query.callback || '') + '(' + jsonBody + ')';
                    cb(0, {mimeType: jsonMimeType, body: jsonBody});
                }
            }, cb, this));
        }
    }
};

// *************************************************************************************************

function sendPage(req, res, compressed, entry) {
    var headers = {
        'Content-Type': entry.mimeType || htmlMimeType
    };
    var body = entry.body;
    if (compressed && entry.bodyZipped) {
        headers['Content-Encoding'] = 'gzip';
        body = entry.bodyZipped;
    }

    res.send(body, headers, 200);
}


function sendError(req, res, mimeType, err) {
    if (err) {
        dandy.logException(err,
            "Error while loading " + req.url);
    }

    var message;
    if (!debugMode) {
        if (mimeType == jsonMimeType) {
            message = JSON.stringify({error: 'Error'});
        } else {
            message = 'Error';
        }
    } else {
        if (mimeType == jsonMimeType) {
            message = JSON.stringify({error: err+'', stack: err.stack});
        } else {
            message = err+'';
        }
    }    

    res.send(message, {'Content-Type': mimeType}, 500);
}

function postsForClient(posts) {
    var clientPosts = [];
    for (var i = 0; i < posts.length; ++i) {
        var post = posts[i];
        clientPosts.push({
           title: post.title,
           date: post.date,
           url: post.url,
           group: post.group,
           body: post.body,
           attachments: post.attachments
        });
    }
    return {posts: clientPosts};
}

function formatDate(postDate) {
    return postDate ? datetime.format(postDate, '%B %e%k, %Y') : '';
}

function renderRSSBody(post) {
    var html = post.body;
    if (post.attachments) {
        post.attachments.forEach(function(img) {
            html += '<a href="' + img.largs + '">' + '<img src="' + img.thumb + '">' + '</a>&nbsp;';        
        });
    }
    return html;
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

function readSettings(appSettings, settings, configNames) {
    if (appSettings) {
        for (var name in appSettings) {
            if (name == 'configs') {
                var configs = appSettings[name];
                configNames.forEach(function(configName) {
                    var subsettings = configs[configName];
                    if (subsettings) {
                        for (var subname in subsettings) {
                            settings[subname] = subsettings[subname];
                        }
                    }
                });
            } else {
                settings[name] = appSettings[name];
            }
        }
    }
    return settings;
}

function normalizePath(thePath) {
    thePath = path.resolve(thePath);
    thePath = thePath.replace('~', process.env.USER);
    return thePath;
}
