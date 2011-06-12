
var express = require('express');
var fs = require('fs');
var path = require('path');
var Step = require('step');
var jade = require('jade');
var stylus = require('stylus');
var jsdom = require('jsdom');
var gzip = require('gzip');
var uglify = require('uglify-js');
var _ = require('underscore');
var datetime = require('datetime');
var Blog = require('./Blog').Blog;

// *************************************************************************************************

var defaultPort = 8080;

var rePostFileName = /(\d{4})-(\d{2})-(\d{2}).(md|markdown)/;

var debugMode = process.env.NODE_ENV != 'production';

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

    renderCachedPage: function(blog, fn, category) {
        return _.bind(function(req, res) {
            // Comment out to disable caching
            //return fn(req, res, category);

            try {
                var url = blog.normalizeURL(req.url);
                blog.diskCache.load(url, category, _.bind(function(err, body) {
                    if (err || !body || !body.length) {
                        blog.diskCache.lock(url);
                        fn(req, res, category);
                    } else {
                        sendPage(req, res, true, body);
                    }
                }, this));
            } catch (exc) {
                console.log(exc.stack);
            }
        }, this);
    },

    cachePage: function(url, body, blog, category, cb) {
        gzip(body, function(err, data) {
            blog.diskCache.store(url, data, category, function(err) {
                if (cb) cb(0, data);
            });
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
        app.get('/', this.renderCachedPage(blog, indexPage, 'index'));
        app.get('/page/:page', this.renderCachedPage(blog, indexPage, 'index'));
        app.get('/:year/:month/:day/:id', this.renderCachedPage(blog, postPage, 'post'));
        app.get('/about', this.renderCachedPage(blog, aboutPage, 'post'));
        app.get('/drafts', this.renderCachedPage(blog, draftsPage, 'drafts'));
        app.get('/rss.xml', this.renderCachedPage(blog, rssPage, 'index'));
        // app.get('*', errorPage);

        var server = this;

        var jadeContext = {
            formatDate: function(postDate) {
                return postDate ? datetime.format(postDate, '%B %e%k, %Y') : '';
            },

            formatBody: function(body) {
                var doc = jsdom.jsdom(body);
                var scripts = doc.getElementsByTagName('script');
                while (scripts.length) {
                    var script = scripts[i];
                    var info = JSON.parse(script.innerHTML);
                    var link = doc.createElement('a');
                    link.href = info.large;
                    var img = doc.createElement('img');
                    img.src = info.thumb;
                    link.appendChild(img);
                    script.parentNode.replaceChild(link, script);
                }
                return doc.innerHTML;
            },

            stylesheets: function() {
                if (debugMode) {
                    var tags = [];
                    for (var i = 0; i < arguments.length; ++i) {
                        var url = arguments[i];
                        var ext = path.extname(url);
                        if (ext == '.styl') {
                            url = path.join(path.dirname(url), path.basename(url, ext) + '.css');
                        }
                        tags.push('<link rel="stylesheet" href="' + url + '">');
                    }
                    return tags.join('\n');
                } else {
                    var sources = [];
                    for (var i = 0; i < arguments.length; ++i) {
                        var url = arguments[i];
                        var sourcePath = path.join(blog.appPath, 'static', url);
                        var source = fs.readFileSync(sourcePath)+'';
                        source = renderStylus(source, sourcePath, true);
                        sources.push(source);
                    }
                    var source = sources.join('\n');
                    return '<style type="text/css">\n' + source + '\n</style>';
                }
            },

            javascripts: function() {
                if (debugMode) {
                    var tags = [];
                    for (var i = 0; i < arguments.length; ++i) {
                        var url = arguments[i];        
                        tags.push('<script type="text/javascript" src="' + url + '"></script>');
                    }
                    return tags.join('\n');
                } else {
                    var sources = [];
                    for (var i = 0; i < arguments.length; ++i) {
                        var url = arguments[i];
                        var sourcePath = path.join(blog.appPath, 'static', url);
                        var source = fs.readFileSync(sourcePath);
                        sources.push(source);
                    }
                    var source = sources.join('\n');
                    source = compressJavaScript(source);
                    return '<script type="text/javascript">\n' + source + '\n</script>';
                }
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

        function indexPage(req, res, category) {
            var pageNum = req.params.page ? parseInt(req.params.page)-1 : 0;
            renderMultiplePosts(req, res, 'index', pageNum, category, function() {
                blog.getPostsByPage(pageNum, blog.postsPerPage, true, this);
            });
        }

        function rssPage(req, res, category) {
            renderMultiplePosts(req, res, 'rss', 0, category, function() {
                blog.getPostsByPage(0, blog.postsPerPage, true, this);
            });
        }

        function aboutPage(req, res, category) {
            renderSinglePost(req, res, category, function() {
                blog.getPostsByGroup('about', true, this);
            });
        }

        function draftsPage(req, res, category) {
            renderMultiplePosts(req, res, 'index', 0, category, function() {
                blog.getPostsByGroup('drafts', true, this);
            });
        }

        function postPage(req, res, category) {
            renderSinglePost(req, res, category, function() {
                blog.getPost(req.params.id, req.params.year, req.params.month, req.params.day, true, this);
            });
        }

        function errorPage(req, res, category) {
            renderError(req, res, 404, 'Not Found');
        }

        function renderMultiplePosts(req, res, viewName, pageNum, category, fn) {
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
                        renderPage(req, res, viewName, category, {
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

        function renderSinglePost(req, res, category, fn) {
            Step(
            fn,
            function(err, posts) {
                try {
                    if (err) {
                        renderError(req, res, 500, err);
                    } else if (!posts || !posts.length) {
                        renderError(req, res, 404, 'Not Found');
                    } else {
                        renderPage(req, res, 'post', category, {
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
            if (!debugMode) {
                res.send('Error', {'Content-Type': 'text/html'}, code);
            } else {
                res.send('Error: ' + description, {'Content-Type': 'text/html'}, code);
                //throw description;
            }
        }

        function renderPage(req, res, name, category, locals) {
            var jadePath = path.join(blog.appPath, 'views', name + '.jade');
            jade.renderFile(jadePath, {locals: locals}, function(err, html) {
                if (err) {
                    renderError(req, res, 500, err);
                } else {
                    var url = blog.normalizeURL(req.url);
                    server.cachePage(url, html, blog, category, function(err, data) {
                        sendPage(req, res, true, data);
                    });
                }
            });
        }
    }
};

// *************************************************************************************************

function sendPage(req, res, compressed, html) {
    var headers = {
        'Content-Type': 'text/html'
    };
    if (compressed) {
        headers['Content-Encoding'] = 'gzip';
    }

    res.send(html, headers, 200);
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

function compressJavaScript(code) {
    var jsp = uglify.parser;
    var pro = uglify.uglify;

    var ast = jsp.parse(code);
    ast = pro.ast_mangle(ast);
    ast = pro.ast_squeeze(ast);
    ast = pro.ast_squeeze_more(ast);
    return pro.gen_code(ast);
}

function renderStylus(source, sourcePath, compress) {
    var rendered;
    stylus(source)
        .set('filename', sourcePath)
        .define('url', stylus.url({paths: [path.dirname(sourcePath)]}))
        .set('compress', compress)
        .render(function(err, css) {
            rendered = css;
        });
    return rendered;                       
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
