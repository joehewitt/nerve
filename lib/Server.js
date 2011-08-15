
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
var util = require('util');

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
        assert(modulePaths.length == contentPaths.length,
               "Different number of apps and content supplied.");

        var i = 0;
        async.map(modulePaths,
            _.bind(function(modulePath, cb2) {
                modulePath = normalizePath(modulePath);
                var contentPath = normalizePath(contentPaths[i]);

                var blog = new Blog(modulePath, contentPath);
                blog.init(configName, options, _.bind(function(err, app) {
                    assert(!err, "Unable to load app at " + modulePath);

                    blog.server = this.getServerForBlog(blog);
                    this.addBlog(blog);
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
                if (debugMode) {
                    return fn(req, res, category, function(err, result) {
                        if (err) {
                            sendError(req, res, mimeType, err);
                        } else {
                            sendPage(req, res, false, result);
                        }
                    });
                } else {
                    var url = blog.normalizeURL(req.url);
                    blog.diskCache.load(url, category, _.bind(function(err, result) {
                        if (err || !result || !result.body.length) {
                            blog.diskCache.lock(url);
                            fn(req, res, category, _.bind(function(err, result) {
                                if (err) {
                                    sendError(req, res, mimeType, err);
                                } else {
                                    this.cachePage(url, result, blog, category, function(err, result) {
                                        sendPage(req, res, true, result);
                                    });                            
                                }
                            }, this));
                        } else {
                            sendPage(req, res, true, result);
                        }
                    }, this));
                }
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
        //D&&D('MODIFIED ', post.title);
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
        blog.logStream = fs.createWriteStream(blog.logPath, {flags: 'a'});

        server.configure(function() {
            server.set('views', path.join(blog.appPath, 'views'));
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
        this.addRoutesForBlog(server, blog);
        appjs.configure(server, blog.app, {});

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
    },

    addRoutesForBlog: function(app, blog) {
        app.get('/api/page/:page',
                this.renderCachedPage(blog, indexPage, 'index', jsonMimeType));
        app.get('/api/posts',
                this.renderCachedPage(blog, postsPage, 'index', jsonMimeType));
        app.get('/api/posts/:page',
                this.renderCachedPage(blog, postsPage, 'index', jsonMimeType));
        // Give drafts a dedicated category so editing drafts will not invalidate published content
        app.get('/api/group/drafts',
                this.renderCachedPage(blog, draftsPage, 'drafts', jsonMimeType));
        app.get('/api/group/:name',
                this.renderCachedPage(blog, groupPage, 'post', jsonMimeType));
        app.get('/api/post/:year/:month/:day/:id',
                this.renderCachedPage(blog, postPage, 'post', jsonMimeType));
        app.get('/api/*', renderError);
        
        if (blog.app.settings.rss) {
            app.get(blog.app.settings.rss,
                    this.renderCachedPage(blog, rssPage, 'index', rssMimeType));
        }

        function indexPage(req, res, category, cb) {
            renderJSONPosts(req, res, category, 'all', function() {
                var pageNum = req.params.page ? parseInt(req.params.page)-1 : 0;
                blog.getPostsByPage(pageNum, blog.postsPerPage, true, this);
            }, cb);
        }

        function postsPage(req, res, category, cb) {
            renderJSONPosts(req, res, category, 'links', function() {
                if (req.params.page) {
                    var pageNum = req.params.page ? parseInt(req.params.page)-1 : 0;
                    blog.getPostsByPage(pageNum, blog.postsPerPage, true, this);                
                } else {
                    blog.getAllPosts(this);
                }
            }, cb);
        }

        function groupPage(req, res, category, cb) {
            renderJSONPosts(req, res, category, 'all', function() {
                var group = req.params.name;
                blog.getPostsByGroup(group, true, this);
            }, cb);
        }

        function draftsPage(req, res, category, cb) {
            var URL = url.parse(req.url, true);
            if (URL.query.pass == blog.password) {
                renderJSONPosts(req, res, category, 'all', function() {
                    blog.getPostsByGroup("drafts", true, this);
                }, cb);
            } else {
                renderError(req, res);
            }
        }

        function postPage(req, res, category, cb) {
            renderJSONPosts(req, res, category, 'all', function() {
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

        function renderJSONPosts(req, res, category, format, fn, cb) {
            Step(
            fn,
            abind(function(err, posts) {
                var clientPosts = postsForClient(posts, format);
                var jsonBody = JSON.stringify(clientPosts);
                var URL = url.parse(req.url, true);
                jsonBody = (URL.query.callback || '') + '(' + jsonBody + ')';
                
                var deps = _.map(posts, function(post) {
                    return {mtime: post.mtime.getTime()}
                });
                cb(0, {mimeType: jsonMimeType, body: jsonBody, dependencies: deps});
            }, cb, this));
        }

        function renderError(req, res) {
            sendError(req, res, jsonMimeType, {error: 404}, 404)
        }
    }
};

// *************************************************************************************************

function sendPage(req, res, compressed, result) {
    var headers = {};

    headers['Content-Type'] = result.mimeType || htmlMimeType;
    headers['Date'] = new Date()+'';
    headers['Vary'] = 'Accept-Encoding';
    headers['Server'] = 'Nerve';

    var latestTime = findLatestMtime(result.dependencies || []);
    if (latestTime) {
        headers['ETag'] = latestTime;
    }

    if (1 || result.permanent) {
        headers['Cache-Control'] = 'public, max-age=31536000';
    } else {
        headers['Cache-Control'] = 'public, max-age=0';
    }

    var ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch == latestTime) {
        res.send('', headers, 304);
    } else {
        var body = result.body;
        if (compressed && result.bodyZipped && requestAccepts(req, 'gzip')) {
            headers['Content-Encoding'] = 'gzip';
            body = result.bodyZipped;
        }

        res.send(body, headers, 200);
    }
}

function sendError(req, res, mimeType, err, code) {
    if (err) {
        dandy.logException(err,
            "Error while loading " + req.url + "\n" + util.inspect(req.headers));
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

    res.send(message, {'Content-Type': mimeType}, code || 500);
}

function postsForClient(posts, format) {
    var clientPosts = [];
    for (var i = 0; i < posts.length; ++i) {
        var post = posts[i];
        if (format == 'links') {
            clientPosts.push({
               title: post.title,
               date: post.date.getTime(),
               url: post.url,
            });            
        } else {
            clientPosts.push({
               title: post.title,
               date: post.date ? post.date.getTime() : 0,
               url: post.url,
               group: post.group,
               body: post.body,
               attachments: post.attachments
            });            
        }
    }
    return {posts: clientPosts};
}

function findLatestMtime(deps) {
    var maxTime = 0;
    _.each(deps, function(dep) {
        if (dep.mtime > maxTime) {
            maxTime = dep.mtime;
        }
    });
    return maxTime;
}

function formatDate(postDate) {
    return postDate ? datetime.format(postDate, '%B %e%k, %Y') : '';
}

function requestAccepts(req, encoding) {
    var accepts = 'accept-encoding' in req.headers ? req.headers['accept-encoding'].split(/\s*,\s*/) : [];
    return accepts.indexOf(encoding) != -1;
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
