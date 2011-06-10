
var express = require('express');
var fs = require('fs');
var path = require('path');
var Step = require('step');
var jade = require('jade');
var stylus = require('stylus');
var jsdom = require('jsdom');
var _ = require('underscore');
var datetime = require('datetime');
var Blog = require('./Blog').Blog;

// *************************************************************************************************

var defaultPort = 8080;

var rePostFileName = /(\d{4})-(\d{2})-(\d{2}).(md|markdown)/;

// *************************************************************************************************

function Server(port) {
    this.port = port || defaultPort;
    this.blogs = [];
}    

Server.prototype = {
    addBlog: function(blog) {
        this.blogs.push(blog);
    },

    restart: function() {
        if (this.app) {
            this.app.stop();
        }      

        var apps = [];
        for (var i = 0; i < this.blogs.length; ++i) {
            var blog = this.blogs[i];
            var app = this.getServerForBlog(blog);
            if (app) {
                blog.app = app;
                apps.push(app);                

                this.monitorBlog(blog);
            }
        }

        if (apps.length == 1) {
            this.mainApp = apps[0];
        } else {
            this.mainApp = express.createServer();
            for (var i = 0; i < this.blogs.length; ++i) {
                var blog = this.blogs[i];
                if (!blog.hostName) {
                    throw new Exception("Blog requires a host name (" + blog.appPath + ")");
                }
                this.mainApp.use(express.vhost(blog.hostName, blog.app));    
            }            
        }

        this.mainApp.listen(this.port);
        console.log("Nerve server listening on port %d", this.mainApp.address().port);
    },

    renderCachedPage: function(blog, fn) {
        return _.bind(function(req, res) {
            try {
                var url = blog.normalizeURL(req.url);
                blog.diskCache.load(url, _.bind(function(err, body) {
                    if (err || !body || !body.length) {
                        fn(req, res);
                    } else {
                        sendPage(req, res, body);
                    }
                }, this));
            } catch (exc) {
                console.log(exc.stack);
            }
        }, this);
    },

    cachePage: function(url, body, blog) {
        blog.diskCache.store(url, body);
    },

    uncachePage: function(url, blog) {
        blog.diskCache.remove(url);
    },

    resetPageCache: function(blog) {
        blog.diskCache.removeAll();
    },

    postModified: function(post) {
        console.log('MODIFIED ', post.title);
        if (post.isChronological) {
            // XXXjoe Need a more surgical way to delete only index pages that reference the post
            this.resetPageCache(post.blog);
        } else {
            this.uncachePage(post.url, post.blog);
        }
    },

    monitorBlog: function(blog) {
        blog.on('postCreated', _.bind(this.postModified, this));
        blog.on('postChanged', _.bind(this.postModified, this));
        blog.on('postDeleted', _.bind(this.postModified, this));
    },

    getServerForBlog: function(blog) {
        var app = express.createServer();
        var logStream = fs.createWriteStream(blog.logPath, {flags: 'a'});

        app.configure(function(){
        app.set('views', path.join(blog.appPath, 'views'));
            app.set('view engine', 'jade');
            app.use(express.bodyParser());
            app.use(express.methodOverride());
            app.use(stylus.middleware({
                src: path.join(blog.appPath, 'static'),
                compile: stylusCompileMethod(path.join(blog.appPath, 'static', 'stylesheets'))
            }));
            app.use(express.logger({stream: logStream}));
            app.use(app.router);
            app.use(express.static(path.join(blog.appPath, 'static')));
        });

        app.configure('development', function() {
            app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
        });

        app.configure('production', function() {
            app.use(express.errorHandler()); 
        });

        this.getRouterForBlog(app, blog);

        return app;
    },

    getRouterForBlog: function(app, blog) {
        app.get('/', this.renderCachedPage(blog, indexPage));
        app.get('/page/:page', this.renderCachedPage(blog, indexPage));
        app.get('/:year/:month/:day/:id', this.renderCachedPage(blog, postPage));
        app.get('/about', this.renderCachedPage(blog, aboutPage));
        app.get('/drafts', this.renderCachedPage(blog, draftsPage));
        app.get('/rss.xml', this.renderCachedPage(blog, rssPage));
        // app.get('*', errorPage);

        var server = this;

        var jadeContext = {
            formatDate: function(postDate) {
                return postDate ? datetime.format(postDate, '%B %e%k, %Y') : '';
            },

            formatBody: function(body) {
                var doc = jsdom.jsdom(body);
                var scripts = doc.getElementsByTagName('script')
                for (var i = 0; i < scripts.length; ++i) {
                    var script = scripts[i];
                    script.parentNode.removeChild(script);      
                }
                return doc.documentElement.innerHTML;
            },

            facebookComments: function(url) {
                return '<div id="fb-root"></div>'
                    + '<script src="http://connect.facebook.net/en_US/all.js#appId='
                    + blog.facebookAppId+'&amp;xfbml=1">'
                    + '</script><fb:comments href="'+url+'" num_posts="2" width="352"></fb:comments>';
            },

            facebookCommentCount: function(url) {
                return '<div id="fb-root"></div>' 
                    + '<script src="http://connect.facebook.net/en_US/all.js#appId='
                    + blog.facebookAppId+'&amp;xfbml=1">'
                    + '</script><fb:comments-count href="'+url+'"></fb:comments-count>';
            }
        };

        function indexPage(req, res) {
            var pageNum = req.params.page ? parseInt(req.params.page)-1 : 0;
            renderMultiplePosts(req, res, 'index', pageNum, function() {
                blog.getPostsByPage(pageNum, blog.postsPerPage, true, this);
            });
        }

        function rssPage(req, res) {
            renderMultiplePosts(req, res, 'rss', 0, function() {
                blog.getPostsByPage(0, blog.postsPerPage, true, this);
            });
        }

        function aboutPage(req, res, fileName) {
            renderSinglePost(req, res, function() {
                blog.getPostsByGroup('about', true, this);
            });
        }

        function draftsPage(req, res, fileName) {
            renderMultiplePosts(req, res, 'index', 0, function() {
                blog.getPostsByGroup('drafts', true, this);
            });
        }

        function postPage(req, res) {
            renderSinglePost(req, res, function() {
                blog.getPost(req.params.id, req.params.year, req.params.month, req.params.day, true, this);
            });
        }

        function errorPage(req, res) {
            renderError(req, res, 404, 'Not Found');
        }

        function renderMultiplePosts(req, res, viewName, pageNum, fn) {
            Step(
            fn,
            function(err, posts) {
                try {
                    if (err) {
                        renderError(req, res, 500, err);
                    } else if (!posts.length) {
                        renderError(req, res, 404, 'Not Found');
                    } else {
                        var isLastPage = (pageNum+1)*blog.postsPerPage < blog.datedPosts.length;
                        renderPage(req, res, viewName, {
                            context: jadeContext,
                            title: blog.title,
                            posts: posts,
                            olderLink: isLastPage ? '/page/'+(pageNum+2) : '',
                            newerLink: pageNum > 0 ? '/page/'+(pageNum) : ''
                        });
                    }
                } catch (exc) {
                    renderError(req, res, 500, 'Bad baby');
                }
            });
        }

        function renderSinglePost(req, res, fn) {
            Step(
            fn,
            function(err, posts) {
                try {
                    if (err) {
                        renderError(req, res, 500, err);
                    } else if (!posts || !posts.length) {
                        renderError(req, res, 404, 'Not Found');
                    } else {
                        renderPage(req, res, 'post', {
                            context: jadeContext,
                            title: posts[0].title,
                            post: posts[0],
                        });
                    }
                } catch (exc) {
                    renderError(req, res, 500, 'Bad baby');
                }
            });
        }

        function renderError(req, res, code, description) {
            if (process.env['NODE_ENV'] == 'production') {
                res.send('Error', {'Content-Type': 'text/html'}, code);
            } else {
                res.send('Error: ' + description, {'Content-Type': 'text/html'}, code);
                //throw description;
            }
        }

        function renderPage(req, res, name, locals) {
            var jadePath = path.join(blog.appPath, 'views', name + '.jade');
            jade.renderFile(jadePath, {locals: locals}, function(err, html) {
                if (err) {
                    renderError(req, res, 500, err);
                } else {
                    var url = blog.normalizeURL(req.url);
                    server.cachePage(url, html, blog);
                    sendPage(req, res, html);
                }
            });
        }
        
    }
};

// *************************************************************************************************

function sendPage(req, res, html) {
    res.send(html, {'Content-Type': 'text/html'}, 200);
}

function stylusCompileMethod(stylesheetsPath) {
    return function(str) {
      return stylus(str)
        .define('url', stylus.url({paths: [stylesheetsPath]}))
        .set('compress', true);
    }
};

function flattenSettings(settings, configName) {
    var settings2 = {};
    for (var name in settings) {
        if (name == 'configs') {
            var subsettings = settings[name][configName];
            if (subsettings) {
                for (var name in subsettings) {
                    settings2[name] = subsettings[name];
                }
            }
        } else {
            settings2[name] = settings[name];
        }
    }
    return settings2;
}

function normalizePath(thePath) {
    thePath = path.resolve(thePath);
    thePath = thePath.replace('~', process.env.USER);
    return thePath;
}

// *************************************************************************************************

exports.run = function(appPath, contentPath, configName) {
    var server = new Server();

    appPath = normalizePath(appPath);
    contentPath = normalizePath(contentPath);

    if (!fs.lstatSync(appPath)) {
        throw new Exception("Blog path not found (" + appPath + ")");
    }
    
    var settings = JSON.parse(fs.readFileSync(path.join(appPath, 'settings.json')));
    settings = flattenSettings(settings, configName||'mac');

    var blog = new Blog(appPath, contentPath, settings);
    server.addBlog(blog);
    
    server.restart();
}
