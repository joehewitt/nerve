
// var D;

var fs = require('fs');
var path = require('path');
var url = require('url');
var events = require('events');
var async = require('async');
var glob = require('glob');
var _ = require('underscore');
var markdom = require('markdom');
var watch = require('watch');
var bcrypt = require('bcrypt');
var datetime = require('datetime');
var cacheware = require('express-cache');
var abind = require('dandy/errors').abind;
var ibind = require('dandy/errors').ibind;
var NerveAPI = require('./NerveAPI').NerveAPI;
var Post = require('./Post').Post;
var NerveTransformer = require('./NerveTransformer').NerveTransformer;
var syndicate = require('./syndicate');

// *************************************************************************************************

var rePostFileName = /(\d{4})-(\d{2})-(\d{2}).(md|markdown)/;
var defaultApiPath = '/api';
var defaultTimeZone = 'PST';
var postIndex = 0;
var imagesDirName = 'images';

// *************************************************************************************************

function Blog(conf, cb) {
    events.EventEmitter.call(this);

    this.datedPosts = [];
    this.groupedPosts = {};
    this.transforms = [];
    this.isInvalid = true;

    this._assignConf(conf);

    this.reload = aggregate(this.reload);
    this.reload(cb);
}

exports.Blog = Blog;

function subclass(cls, supercls, proto) {
    cls.super_ = supercls;
    cls.prototype = Object.create(supercls.prototype, {
        constructor: {value: cls, enumerable: false}
    });
    _.extend(cls.prototype, proto);
}

subclass(Blog, events.EventEmitter, {
    useApp: function(app) {
        this.app = app;

        if (app) {
            this._findContent(_.bind(function() {
                this.contentPaths.forEach(function(contentPath) {
                    if (contentPath.all) {
                        app.paths.unshift(contentPath.path);
                    }            
                });
            }, this));
        }        
    },

    rssRoute: function(numberOfPosts) {
       var rssRoute = syndicate.route(this, numberOfPosts);
       if (this.cache) {
           return [cacheware(this.cache), rssRoute];
       } else {
           return rssRoute;
       }
    },

    apiRoute: function() {
        var apiRoute = this.api.route();
        if (this.cache) {
               return [cacheware(this.cache), apiRoute];
        } else {
            return apiRoute;
        }
    },

    contentRoute: function() {
        var contentRoute = _.bind(function(req, res) {
            res.sendSafely(_.bind(function(cb) {
                var urlPath = req.params[0].split('/');
                if (urlPath.length > 1 && urlPath[0] == imagesDirName) {
                    var imageFileName = urlPath[1];
                    var imageSize = urlPath[2];
                    var imagePath = path.join(this.contentPaths[0].path, imagesDirName, imageFileName);
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
                        if (m[1]) {
                            options.width = parseInt(m[1]);
                        }
                        if (m[2]) {
                            options.height = parseInt(m[2]);
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
            }, this));
        }, this); 

        if (this.cache) {
            return [cacheware(this.cache), contentRoute];
        } else {
            return contentRoute;
        }
    },

    setPassword: function(password) {
        if (this.passwordPath) {
            var salt = bcrypt.gen_salt_sync(10);
            this.password = bcrypt.encrypt_sync(password, salt);
            fs.writeFileSync(this.passwordPath, this.password);
        }
    },

    checkPassword: function(password, cb) {
        async.waterfall([
            ibind(function(next) {
                this._findContent(next);
            }, cb, this),

            ibind(function(next) {
                if (this.contentPaths.length && !this.passwordPath) {
                    this.passwordPath = path.join(this.contentPaths[0].path, '.nervepass');
                    fs.readFile(this.passwordPath, _.bind(function(err, data) {
                        if (!err) {
                            this.password = (data+'').trim();
                        }
                        next(err);
                    }, this));
                } else {
                    next(0);
                }
            }, cb, this),

            ibind(function(next) {
                if (this.password && password) {
                    var passed = bcrypt.compare_sync(password, this.password);
                    next(0, passed);
                } else {
                    next(0, false);
                }
            }, cb, this)
        ], cb);
    },

    monitorAll: function(cb) {
        this._findContent(abind(function(err) {
            async.map(this.contentPaths, ibind(function(item, cb2) {
                this.monitor(item.path, cb2);
            }, cb, this), ibind(function(err) {
                if (err) {
                    // XXXjoe Need to rollback monitors here
                } else {
                    this.isMonitoring = true;                
                }
                if (cb) cb(err);
            }, cb, this));
        }, cb, this))
    },

    monitor: function(contentPath, cb) {
        watch.createMonitor(contentPath, {interval: 1000}, _.bind(function(monitor) {
            monitor.on("created", _.bind(function(f, stat) {
                D&&D('Created', f);
                this.invalidate();
            }, this))
            monitor.on("changed", _.bind(function(f, stat, prev) {
                if (stat.mtime.getTime() != prev.mtime.getTime()) {
                    D&&D('Changed', f);
                    this.invalidate();
                }
            }, this));
            monitor.on("removed", _.bind(function(f, stat) {
                D&&D('Removed', f);
                this.invalidate();
            }, this));

            if (cb) cb(0);
        }, this));
    },
    
    invalidate: function() {
        this.isInvalid = true;

        // This is a workaround for a quirk on my EC2 instance where Dropbox deletes
        // files momentarily while syncing changes, but watch only reports the removal
        // but not the file being recreated.  So, we have to wait an arbitrary amount
        // to be sure the file is restored before reloading again.
        setTimeout(_.bind(function() {
            this.reload();
        }, this), 50);
    },

    reload: function(cb) {
        if (!this.isInvalid) {
            if (cb) cb(0);
            return;
        }

        var firstLoad = !this.posts;
        var postMap = {};

        if (this.posts) {
            this.posts.forEach(function(post) {
               if (post.path in postMap) {
                    postMap[post.path].push(post);
                } else {
                    postMap[post.path] = [post];
                }
            });
        }

        var newPosts = [];
        var events = [];

        this.statPosts(abind(function(err, statMap) {
            var remaining = _.keys(statMap).length;
            if (!remaining) {
                complete.apply(this);
            }

            _.each(statMap, ibind(function(mtime, filePath) {
                if (!postMap[filePath]) {
                    this._parsePostsFile(filePath, abind(function(err, posts) {
                        newPosts.push.apply(newPosts, posts);

                        if (!firstLoad) {
                            posts.forEach(ibind(function(post) {
                                D&&D('post created', post.title);

                                events.push({event: 'postCreated', post: post});
                            }, cb, this));
                        }
                        next.apply(this);
                    }, cb, this));
                } else {
                    var previousPosts = postMap[filePath];
                    var previousPost = previousPosts[0];
                    if (mtime > previousPost.mtime) {
                        this._parsePostsFile(filePath, abind( function(err, posts) {
                            newPosts.push.apply(newPosts, posts);

                            _.each(posts, ibind(function(post, index) {
                                var existingPost = _.detect(previousPosts, function(oldPost) {
                                    return oldPost.url == post.url;
                                });
                                if (existingPost) {
                                    var index = previousPosts.indexOf(existingPost);
                                    previousPosts.splice(index, 1);
                                    if (!this._postsAreEqual(post, existingPost)) {
                                        D&&D('post changed', post.title);
                                        events.push({name: 'postChanged', post: post});
                                    }
                                } else {
                                    D&&D('post created', post.title);
                                    events.push({name: 'postCreated', post: post});
                                }
                            }, cb, this));

                            // Delete posts that have been removed from their file
                            _.each(previousPosts, ibind(function(oldPost) {
                                D&&D('post deleted', oldPost.title);
                                events.push({name: 'postDeleted', post: oldPost});
                            }, cb, this));
    
                            delete postMap[filePath];
                            next.apply(this);
                        }, cb, this));
                    } else {
                        newPosts.push.apply(newPosts, previousPosts);
                        delete postMap[filePath];
                        next.apply(this);
                    }
                }
           }, cb, this));

           function next() {
               if (!--remaining) {
                   complete.apply(this);
               }
           }

           function complete() {
                // Delete posts in files that have been deleted
                _.each(postMap, ibind(function(posts, path) {
                    _.each(posts, ibind(function(oldPost) {
                        D&&D('post deleted', oldPost.title);
                        events.push({name: 'postDeleted', post: oldPost});
                    }, cb, this));
               }, cb, this));

               this._assignPosts(newPosts);

               _.each(events, _.bind(function(event) {
                   this.emit(event.name, event.post);
                   this.onPostModified(event.post);
               }, this));

               if (!this.isMonitoring) {
                   this.monitorAll(cb);
               } else {
                   cb(0);
               }
           }
        }, cb, this));
    },

    normalizeURL: function(URL, type) {
        if (this.app) {
            return this.app.normalizeURL(URL, type);
        } else {
            return URL;
        }
    },

    onPostModified: function(post) {
        if (this.cache) {
            if (post.isChronological) {
                // D&&D('+ before', require('util').inspect(post, false, 100));
                this.cache.remove('/api/post/' + post.url);
                this.cache.removeAll('/api/page');
                this.cache.removeAll('/api/posts');
                // D&&D(' - after', require('util').inspect(post, false, 100));
            } else {
                if (post.group == 'drafts') {
                    this.cache.remove('/api/group/drafts');
                } else {
                    this.cache.removeAll(post.url);
                }
            }
        }
    },

    statPosts: function(cb) {
        var blog = this;
        var statMap = {};
        var remaining = 1;
        statFiles(this.contentPattern);

        function statFiles(contentPattern) {
            var paths;

            async.waterfall([
                function(next) {
                    glob.glob(contentPattern, next);
                },
                function(matches, next) {
                    paths = matches;

                    async.map(paths, function(aPath, cb2) {
                        fs.lstat(aPath, cb2);
                    }, next);
                },
                function(stats, next) {
                    _.each(stats, function(stat, i) {
                        if (stat.isDirectory()) {
                            ++remaining
                            statFiles(contentPattern + '/*');
                        } else {
                            statMap[paths[i]] = stat.mtime;
                        }
                    });

                    if (!--remaining) {
                        cb(0, statMap);
                    }
                }
            ]);
        }
    },
     
    getAllPosts: function(render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        if (this.isInvalid) {
            this.reload(abind(function() {
                this._returnPosts(this.datedPosts, render, cb);
            }, cb, this));
        } else {
            this._returnPosts(this.datedPosts, render, cb);
        }
    },

    getAllGroupedPosts: function(render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        if (this.isInvalid) {
            this.reload(abind(function() {
                cb(0, this.groupedPosts);
            }, cb, this));
        } else {
            cb(0, this.groupedPosts);
        }
    },
    
    getPostsByPage: function(pageNum, pageSize, render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        this.getAllPosts(_.bind(function(err, allPosts) {
            if (err) return cb ? cb(err): 0;
            
            var startIndex = pageNum*pageSize;
            var posts = allPosts.slice(startIndex, startIndex+pageSize);

            return this._returnPosts(posts, render, cb);
        }, this));
    },
    
    getPostsByDay: function(year, month, day, render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        this.getAllPosts(_.bind(function(err, allPosts) {
            if (err) return cb ? cb(err) : 0;

            var target = [year, month, day].join('-');
            var posts = _.select(allPosts, function(post) {
                return datetime.format(post.date, '%Y-%m-%d') == target;
            });

            return this._returnPosts(posts, render, cb);
        }, this));
    },
    
    getPost: function(slug, year, month, day, render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        this.getPostsByDay(year, month, day, _.bind(function(err, allPosts) {
            if (err) return cb ? cb(err) : 0;

            var posts = _.select(allPosts, function(post) {
                return post.slug == slug;
            });

            return this._returnPosts(posts, render, cb);
        }, this));
    },
    
    getPostsByGroup: function(groupName, render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        this.getAllGroupedPosts(_.bind(function(err, groupedPosts) {
            if (err) return cb ? cb(err) : 0;

            var posts = groupedPosts[groupName] || [];
            return this._returnPosts(posts, render, cb);
        }, this));
    },

    addTransform: function(transform) {
        this.transforms.push(transform);
    },

    matchTransform: function(URL) {
        var U = url.parse(URL, true);
        var query = U.query;
        U.query = U.search = null;
        URL = url.format(U);

        for (var i = 0; i < this.transforms.length; ++i) {
            var transform = this.transforms[i];
            var m = transform.pattern.exec(URL);
            if (m) {
                return {groups: m.slice(1), query: query, transform: transform};
            }
        }
    },

    _returnPosts: function(posts, render, cb) {
        if (render) {
            this.renderPosts(posts, cb);
        } else {
            cb(0, posts);
        }        
    },

    renderPost: function(post, cb) {
        // Performs nerve-specific parsing
        var transformer = new NerveTransformer(this);
        transformer.visit(post.tree);

        if (!transformer.embeds.length) {
            post.body = markdom.toHTML(post.tree);
            cb(0, post);
        } else {
            // Asynchronously render each of the embeds
            async.mapSeries(transformer.embeds,
                _.bind(function(embed, cb2) {
                    this.renderEmbed(embed, post, cb2);
                }, this),

                abind(function(err, embeds) {
                    post.body = markdom.toHTML(post.tree);
                    cb(0, post);
                }, cb, this)
            );
        }
    },

    renderPosts: function(posts, cb) {
        async.map(posts, _.bind(this.renderPost, this), cb);
    },

    renderEmbed: function(embed, post, cb) {
        var key = embed.key();

        if (this.cache) {
            this.cache.load(key, _.bind(function(err, entry) {
                if (err || !entry) {
                    this._renderEmbed(key, embed, post, cb);
                } else {
                    var result = JSON.parse(entry.body);
                    embed.content = result.content;
                    post.attach.apply(post, result.attachments);
                    cb(0, entry);
                    
                }
            }, this));
        } else {
            this._renderEmbed(key, embed, post, cb);            
        }
    },
    
    // *********************************************************************************************

    _renderEmbed: function(key, embed, post, cb) {
        D&&D('render embed', key);
        embed.transform(post, abind(function(err, result) {
            if (err) return cb(err);
            
            var jsonResult = JSON.stringify(result);
            var entry = {
                key: key,
                body: jsonResult,
                mimeType: "application/json",
                charset: "UTF-8"
            };
            if (this.cache) {
                // XXXjoe Temporarily disable caching
                // this.cache.store(key, entry);
            }

            if (result && result.content) {
                embed.content = result.content;
            }
            if (result && result.attachments) {
                post.attach.apply(post, result.attachments);
            }
            cb(0, entry);
        }, cb, this));        
    },

    _findContent: function(cb) {
        if (this.contentPaths) {
            cb(0);
        } else {
            var directoryMap = {};
            var contentPaths = [];

            glob.glob(this.contentPattern, 0, abind(function(err, matches) {
                async.map(matches, fs.lstat, abind(function(err, stats) {
                    _.each(stats, ibind(function(stat, i) {
                        if (stat.isDirectory() && !directoryMap[matches[i]]) {
                            contentPaths.push({path: matches[i], all: true});
                            directoryMap[matches[i]] = true;
                        } else {
                            var parentDir = path.dirname(matches[i]);
                            if (!directoryMap[parentDir]) {
                                contentPaths.push({path: parentDir, all: true});
                                directoryMap[parentDir] = true;
                            }
                        }
                    }, cb, this))
        
                    this.contentPaths = contentPaths;
                    cb(0);
                }, cb, this))
            }, cb, this));
        }
    },

    _assignConf: function(conf) {
        this.title = conf.title;
        this.host = conf.host;
        this.contentPattern = fixPath(conf.content);
        this.postsPerPage = conf.postsPerPage || 10;
        
        this.api = new NerveAPI(this, conf.api || defaultApiPath);

        if (conf.cache) {
            this.cache = conf.cache;
        }

        if (conf.flickr) {
            var FlickrTransformer = require('./FlickrTransformer').FlickrTransformer;
            this.addTransform(new FlickrTransformer(conf.flickr.key, conf.flickr.secret));
        }

        var ImageTransformer = require('./ImageTransformer').ImageTransformer;
        this.addTransform(new ImageTransformer());

        var FigureTransformer = require('./FigureTransformer').FigureTransformer;
        this.addTransform(new FigureTransformer());

        // XXXjoe Not yet implemented
        // if (conf.facebook) {
        //     var FacebookTransformer = require('./FacebookTransformer').FacebookTransformer;
        //     this.addTransform(new FacebookTransformer(conf.facebook.key, conf.facebook.secret));
        // }
    },

    _parsePostsFile: function(filePath, cb) {
        fs.readFile(filePath, abind(function(err, fileBody) {
            this._statAndParsePosts(fileBody, filePath, cb);
        }, cb, this));
    },

    _statAndParsePosts: function(fileBody, filePath, cb) {
        fs.lstat(filePath, abind(function(err, stat) {
            this._parsePosts(fileBody, filePath, stat, cb);
        }, cb, this));
    },
    
    _parsePosts: function(fileBody, filePath, fileStat, cb) {
        var tree = markdom.toDOM(fileBody);

        var posts = [];
        var currentPost;
        for (var j = 0; j < tree.nodes.length; ++j) {
            var node = tree.nodes[j];
            if (node instanceof markdom.nodeTypes.Header && node.level == 1) {
                var header = node.content.toHTML();
                var info = this._parseHeader(header);

                var slug = info.title.toLowerCase().split(/\s+/).join('-');
                slug = slug.replace(/[^a-z0-9\-]/g, '');

                var dateSlug = info.date ? datetime.format(info.date, '%Y/%m/%d') : null;
                var relativeURL = info.group ? info.group : dateSlug + '/' + slug;

                if (currentPost) {
                    currentPost.source = currentPost.tree.toHTML();
                }

                currentPost = new Post(this);
                currentPost.title = info.title;
                currentPost.slug = slug;
                currentPost.mtime = fileStat.mtime;
                currentPost.path = filePath;
                currentPost.url = relativeURL;
                currentPost.date = info.date;
                currentPost.group = info.group;
                currentPost.tree = new markdom.nodeTypes.NodeSet([]);
                currentPost.postIndex = ++postIndex;
                posts.push(currentPost);
            } else if (currentPost) {
                currentPost.tree.nodes.push(node);
            }
        }

        if (currentPost) {
            currentPost.source = currentPost.tree.toHTML();
        }

        if (cb) cb(0, posts);
    },
    
    _parseHeader: function(header) {
        var reTitle = /(.*?)\s*\[(.*?)\]/;
        var m = reTitle.exec(header);
        if (m && m[2]) {
            var date = new Date(m[2] + " " + defaultTimeZone);
            if (isNaN(date.getTime())) {
                return {title: m[1], group: m[2]};            
            } else {
                return {title: m[1], date: date};
            }
        } else {
            return {title: header, group: 'drafts'};
        }
    },

    _postsAreEqual: function(a, b) {
        return a.title == b.title && a.source == b.source;
    },

    _removePost: function(oldPost, newPost) {
        var index = this.posts.indexOf(oldPost);
        if (newPost) {
            this.posts.splice(index, 1, newPost);
        } else {
            this.posts.splice(index, 1);
            
        }        
        this._assignPosts(this.posts);
    },

    _assignPosts: function(posts) {
        this.posts = posts;
        this.isInvalid = false;

        this.datedPosts = _.select(posts, function(post) {
            return post.date;
        });
        this.datedPosts.sort(function(a, b) {
            if (a.date > b.date) {
                return -1;
            } else {
                if (a.date < b.date) {
                    return 1;
                } else {
                    if (a.postIndex >= b.postIndex) {
                        return 1;
                    } else {
                        return -1;
                    }                
                }
            }
        });
        this.groupedPosts = groupArray(posts, function(post) {
            return post.group;
        });
    },
});

function urlJoin(a, b) {
    if (a[a.length-1] == '/' || b[0] == '/') {
        return a + b;
    } else {
        return a + '/' + b;
    }
}

function groupArray(items, cb) {
    var groups = {};
    for (var i = 0; i < items.length; ++i) {
        var name = cb(items[i], i);
        if (name) {
            var group = groups[name];
            if (group) {
                group.push(items[i]);
            } else {
                groups[name] = [items[i]];
            }
        }
    }
    return groups;
}

function fixPath(thePath) {
    return thePath.replace(/^~/, process.env.HOME);
}

/**
 * Used to prevent redundant calls from an in-progress asynchronous function.
 *
 * If you have an asynchronous function and it is called once and then called again before
 * the first call returns, aggregate prevents the second (and later) calls from happening,
 * but ensures that all callbacks are called when the first call completes.
 */
function aggregate(fn) {
    var callInProgress = false;
    var callbacks = [];

    return function() {
        // Expect the last argument to be a callback function
        var cb = arguments.length ? arguments[arguments.length-1] : null;
        if (cb && typeof(cb) == "function") {
            callbacks.push(cb);
        }

        var cleanup = _.bind(function() {
            // Call all of the callbacks that have aggregated while waiting
            // for the initial call to complete
            var args = arguments;
            callbacks.forEach(_.bind(function(callback) {
                callback.apply(this, args);
            }, this));

            callInProgress = false;
            callbacks = [];
        }, this);

        if (!callInProgress) {
            callInProgress = true;

            var args = [];
            for (var i = 0; i < arguments.length-1; ++i) {
                args.push(arguments[i]);
            }

            args.push(cleanup);
            fn.apply(this, args);
        }
    }    
}
