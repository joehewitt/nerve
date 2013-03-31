
// var D;

var fs = require('fs');
var path = require('path');
var _ = require('underscore');
var util = require('util');
var datetime = require('datetime');
var cacheware = require('express-store');
var dandy = require('dandy/errors');
var abind = require('dandy/errors').abind;
var syndicate = require('./syndicate');
var appjs = require('app.js');
var handlebars = require('handlebars');
var async = require('async');

// *************************************************************************************************

var rePostFileName = /(\d{4})-(\d{2})-(\d{2}).(md|markdown)/;
var defaultApiPath = '/api';
var defaultTimeZone = 'PST';
var postIndex = 0;
var imagesDirName = 'images';
var htmlMimeType = 'text/html';

// *************************************************************************************************

function BlogRouter(blog) {
    this.blog = blog;

    if (blog.cache) {
        blog.cache.on('unmonitor', _.bind(function(URL) {
            D&&D('unmonitor', URL);
            this.invalidateTemplates();
        }, this));
    }
}

exports.BlogRouter = BlogRouter;

BlogRouter.prototype = {
    errorRoute: function(code) {
        return _.bind(function(req, res) {
            this._renderError(code, 'Error', req, res);
        }, this);
    },

    homeRoute: function() {
        var blog = this.blog;
        var router = _.bind(function(req, res) {
            this._renderPosts('posts', req, res, _.bind(function(cb) {
                blog.getPostsByPage(0, blog.postsPerPage || 1, true, cb);
            }, this));
        }, this);

        if (blog.cache) {
           return [cacheware(blog.cache), router];
       } else {
           return router;
       }
    },

    archiveRoute: function() {
        var blog = this.blog;
        var router = _.bind(function(req, res) {
            this._renderPosts('archive', req, res, _.bind(function(cb) {
                blog.getAllPosts(true, cb);
            }, this));
        }, this);

        if (blog.cache) {
           return [cacheware(blog.cache), router];
       } else {
           return router;
       }
    },

    groupRoute: function() {
        var blog = this.blog;
        var router = _.bind(function(req, res) {
            var group = req.params.group;
            if (group == "secret") {
                blog.checkPassword(req.cookies.token||'', _.bind(function(err, passed) {
                    if (passed) {
                    } else {
                        this._renderError(req, res, 401, "Not authorized");
                    }
                }, this));
            } else {
                this._renderPosts('posts', req, res, _.bind(function(cb) {
                    blog.getPostsByGroup(group, true, cb);
                }, this));
            }
        }, this);

        if (blog.cache) {
           return [cacheware(blog.cache), router];
       } else {
           return router;
       }
    },

    postRoute: function() {
        var blog = this.blog;
        var router = _.bind(function(req, res) {
            var year = req.params.year;
            var month = req.params.month;
            var day = req.params.day;
            var slug = req.params.slug;
            this._renderPosts('posts', req, res, _.bind(function(cb) {
                blog.getPost(slug, year, month, day, true, cb);
            }, this));
        }, this);

        if (blog.cache) {
           return [cacheware(blog.cache), router];
       } else {
           return router;
       }
    },

    rssRoute: function(numberOfPosts) {
        var blog = this.blog;
        var rssRoute = syndicate.route(blog, numberOfPosts);
        if (blog.cache) {
            return [cacheware(blog.cache), rssRoute];
        } else {
            return rssRoute;
        }
    },

    apiRoute: function() {
        var blog = this.blog;
        var apiRoute = blog.api.route();
        if (blog.cache) {
               return [cacheware(blog.cache), apiRoute];
        } else {
            return apiRoute;
        }
    },

    contentRoute: function() {
        var blog = this.blog;
        var contentRoute = _.bind(function(req, res) {
            res.sendSafely(_.bind(function(cb) {
                var urlPath = req.params[0].split('/');
                if (urlPath.length > 1 && urlPath[0] == imagesDirName) {
                    var imageFileName = urlPath[1];
                    // var imageSize = urlPath[2];
                    // var imagePath = path.join(blog.contentPaths[0].path, imagesDirName,
                                                // imageFileName);
                    var imageSize = null;//urlPath[2];
                    var imagePath = path.join(blog.contentPaths[0].path, imagesDirName,
                                              urlPath.slice(1).join('/'));
                    if (!imageSize) {
                        cb(0, {path: imagePath});
                    } else {
                        var temp = require('temp');
                        var tempPath = temp.path({suffix: path.extname(imagePath)});
                        
                        var options = {
                            srcPath: imagePath,
                            dstPath: tempPath
                        };

                        var m = /^\s*(\d*)x(\d*)\s*$/.exec(imageSize);
                        if (m) {
                            if (m[1]) {
                                options.width = parseInt(m[1]);
                            }
                            if (m[2]) {
                                options.height = parseInt(m[2]);
                            }
                        }
                        if (options.width && options.height) {
                            options.height += '\!';
                        }
                        var magick = require('imagemagick');
                        magick.resize(options, function(err) {
                            if (err) {
                                console.error(err);
                                cb({error: 500, body: 'Error processing image'});
                            } else {
                                cb(0, {path: tempPath});
                            }
                        });
                    }
                } else {
                    cb({error: 404, body: 'Not found'});
                }
            }, blog));
        }, blog); 

        if (blog.cache) {
            return [cacheware(blog.cache), contentRoute];
        } else {
            return contentRoute;
        }
    },

    invalidateTemplates: function() {
        delete this.templates;
        delete this.templateDependencies;
    },

    _compileTemplates: function(cb) {
        if (this.templates) {
            return cb(0);
        }
        var blog = this.blog;
        var templates = {};
        var deps = this.templateDependencies = [];

        async.mapSeries(['index', 'archive', 'posts', '404', 'error'], function(templateName, cb2) {
            var templatePath = path.join(blog.templatesPath, templateName + '.html');
            fs.readFile(templatePath, 'utf8', function(err, source) {
                if (err) {
                    cb2(err);
                } else {
                    templates[templateName] = handlebars.compile(source+'');
                    fs.stat(templatePath, function(err, stat) {
                        if (err) {
                            cb2(err);
                        } else {
                            deps.push({path: templatePath, mtime: stat.mtime});
                            cb2(0);
                        }
                    });
                }
            });
        }, _.bind(function(err) {
            this.templates = templates;
            cb(err);
        }, this));

        // var indexTemplatePath = path.join(blog.templatesPath, 'index.html');
        // var indexTemplateSource = fs.readFileSync(indexTemplatePath, 'utf8');
        // this.templates['index'] = handlebars.compile(indexTemplateSource+'');

        // var archiveTemplatePath = path.join(blog.templatesPath, 'archive.html');
        // var archiveTemplateSource = fs.readFileSync(archiveTemplatePath, 'utf8');
        // this.templates['archive'] = handlebars.compile(archiveTemplateSource+'');

        // var postsTemplatePath = path.join(blog.templatesPath, 'posts.html');
        // var postsTemplateSource = fs.readFileSync(postsTemplatePath, 'utf8');
        // this.templates['posts'] = handlebars.compile(postsTemplateSource+'');

        // var error404TemplatePath = path.join(blog.templatesPath, '404.html');
        // var error404TemplateSource = fs.readFileSync(error404TemplatePath, 'utf8');
        // this.templates['404'] = handlebars.compile(error404TemplateSource+'');

        // var errorTemplatePath = path.join(blog.templatesPath, 'error.html');
        // var errorTemplateSource = fs.readFileSync(errorTemplatePath, 'utf8');
        // this.templates['error'] = handlebars.compile(errorTemplateSource+'');

        // this.templateDependencies = [
        //     {path: indexTemplatePath, postsTemplatePath, archiveTemplatePath,
        //                              error404TemplatePath, errorTemplatePath];
    },

    _renderPosts: function(templateName, req, res, fetchPosts) {
        var blog = this.blog;
        this._renderPage(templateName, req, res, _.bind(function(cb) {
            fetchPosts(abind(function(err, posts) {
                if (!posts.length) {
                    cb({code: 404});
                } else {
                    var title = req.url != '/' && posts.length == 1
                        ? posts[0].title + ' - ' + blog.title
                        : blog.title;

                    var scripts = [];
                    var stylesheets = [];
                    _.each(posts, function(post) {
                        _.each(post.stylesheets, function(url) {
                            stylesheets.push(url);
                        });
                    });

                    var deps = _.map(posts, function(post) {
                        return {path: post.path, mtime: post.mtime.getTime()}
                    });

                    cb(0, {
                        dependencies: deps,
                        stylesheets: stylesheets,
                        scripts: scripts,
                        data: {
                            title: title,
                            posts: posts
                        }
                    });
                }
            }, cb, this));
        }));
    },

    _renderError: function(code, description, req, res) {
        // dandy.logException(null,
        //     "Error while loading " + req.url + "\n" + util.inspect(req.headers));

        var blog = this.blog;
        var templateName = code == 404 ? '404' : 'error';
        this._renderPage(templateName, req, res, _.bind(function(cb) {
            cb(0, {
                error: code,
                title: 'Error - Joe Hewitt',
                data: {
                    description: description,
                    urlPath: req.url
                }
            });
        }));
    },

    _renderPage: function(templateName, req, res, fetchContent) {
        var blog = this.blog;
        res.sendSafely(_.bind(function(cb) {
            fetchContent(_.bind(function(err, content) {
                if (err) {
                    if (typeof(err) == "object") {
                        this._renderError(err.code, err.description, req, res);  
                    } else {
                        this._renderError(500, "Not authorized", req, res);  
                    }
                } else {
                    blog.app.loadResources(req, abind(function(err, results) {
                        this._compileTemplates(abind(function(err) {
                            // res.dependencies = this.templateDependencies;
                            handlebars.registerPartial('content', this.templates[templateName]);

                            var stylesheets = results.stylesheets;
                            _.each(content.stylesheets, function(url) {
                                var tag = '<link rel="stylesheet" href="' + url + '">';
                                stylesheets += '\n' + tag;
                            });

                            var scripts = results.scripts;
                            _.each(content.scripts, function(url) {
                                var tag = '<script type="text/javascript" src="' + url + '"></script>';
                                scripts += '\n' + tag;
                            });

                            content.scripts = scripts;
                            content.stylesheets = stylesheets;

                            var templateData = {
                                blog: blog,
                                scripts: scripts,
                                stylesheets: stylesheets,
                                icons: results.icons
                            };
                            for (var name in content.data) {
                                templateData[name] = content.data[name];
                            }

                            var template = this.templates['index'];
                            var html = template(templateData);

                            var deps = [];
                            // deps.push.apply(deps, content.dependencies);
                            deps.push.apply(deps, this.templateDependencies);
                            
                            if (content.error) {
                                cb({error: content.error}, {mimeType: htmlMimeType, body: html});
                            } else {
                                cb(0, {
                                    dependencies: deps,
                                    mimeType: htmlMimeType,
                                    body: html});
                            }
                        }, cb, this));
                    }, cb, this));
                }
            }, this));
        }, this));
    }    
};

function findLatestMtime(dependencies) {
    var maxTime = 0;
    _.each(dependencies, function(dep) {
        if (dep.mtime > maxTime) {
            maxTime = dep.mtime;
        }
    });
    return maxTime;
}
