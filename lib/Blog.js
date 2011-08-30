
var fs = require('fs');
var path = require('path');
var URL = require('url');
var events = require('events');
var Step = require('step');
var async = require('async');
var glob = require('glob');
var _ = require('underscore');
var markdom = require('markdom');
var watch = require('watch');
var bcrypt = require('bcrypt');
var datetime = require('datetime');
var mkdirsSync = require('mkdir').mkdirsSync;
var Cache = require('diskcache').Cache;
var appjs = require('appjs');
var abind = require('dandy/errors').abind;
var ibind = require('dandy/errors').ibind;

var Post = require('./Post').Post;
var ImageEmbedder = require('./ImageEmbedder').ImageEmbedder;

// *************************************************************************************************

var rePostFileName = /(\d{4})-(\d{2})-(\d{2}).(md|markdown)/;

// *************************************************************************************************

function Blog(appPath, contentPattern) {
    events.EventEmitter.call(this);

    this.module = require(appPath);
    this.appPath = appPath;
    this.contentPattern = contentPattern;
    this.contentPaths = [];
    this.datedPosts = [];
    this.groupedPosts = {};
    this.transforms = [];
    this.isInvalid = true;
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
    init: function(configName, options, cb) {
        this._findContent(this.contentPattern, abind(function(err) {
            appjs.loadApp(this.appPath, configName, options, abind(function(err, app) {
                this.app = app;
                
                var debugConfig = process.env.NODE_ENV ||  "development";
                var configNames = [debugConfig, app.configName]
                var settings = readSettings(app.packageInfo.nerve, {}, configNames);
                this._useSettings(settings, abind(function(err) {
                    cb(0, this);
                }, cb, this));
            }, cb, this));
        }, cb, this));
    },

    configure: function(server) {
        if (this.module.configure) {
            this.module.configure(this, server);
        }
    },

    setPassword: function(password) {
        if (this.passwordPath) {
            var salt = bcrypt.gen_salt_sync(10);
            this.password = bcrypt.encrypt_sync(password, salt);
        
            fs.writeFileSync(this.passwordPath, this.password);
        }
    },

    checkPassword: function(password) {
        if (this.password && password) {
            return bcrypt.compare_sync(password, this.password);
        }
    },

    monitor: function(contentPath) {
        watch.createMonitor(contentPath, _.bind(function(monitor) {
            monitor.on("created", _.bind(function(f, stat) {
                D&&D('created', f);
                this.invalidate();
            }, this))
            monitor.on("changed", _.bind(function(f, stat, prev) {
                if (stat.mtime.getTime() != prev.mtime.getTime()) {
                    D&&D('changed', f);
                    this.invalidate();
                }
            }, this));
            monitor.on("removed", _.bind(function(f, stat) {
                D&&D('removed', f);
                this.invalidate();
            }, this));
        }, this));
    },
    
    invalidate: function() {
        this.isInvalid = true;

        // This is a workaround for a quirk on my EC2 instance where Dropbox deletes
        // files momentarily while syncing changes, but watch only reports the removal
        // but not the file being recreated.  So, we have to wait an arbitrary amount
        // to be sure the file is restored before reloading again.
        setTimeout(_.bind(function() {
            this.reload(function(){});
        }, this), 50);
    },

    reload: function(cb) {
        if (!this.isInvalid) {
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
               }, this));

               cb(0);               
           }
        }, cb, this));
    },

    normalizeURL: function(url) {
        return URL.resolve(this.baseURL, url);
    },

    statPosts: function(cb) {
        var blog = this;
        var statMap = {};
        var remaining = 1;
        statFiles(this.contentPattern);

        function statFiles(contentPattern) {
            var paths;

            Step(
            function() {
                glob.glob(contentPattern, this);
            },
            function(err, matches) {
                if (err) return cb ? cb(err): 0;

                paths = matches;

                var stats = this.group();
                _.each(paths, function(aPath) {
                    fs.lstat(aPath, stats());
                });
            },
            function(err, stats) {
                if (err) return cb ? cb(err): 0;

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
            });
        }
    },
     
    getAllPosts: function(cb) {
        if (this.isInvalid) {
            this.reload(abind(function() {
                cb(0, this.datedPosts, this.groupedPosts);
            }, cb, this));
        } else {
            cb(0, this.datedPosts, this.groupedPosts);
        }
    },
    
    getPostsByPage: function(pageNum, pageSize, render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        this.getAllPosts(_.bind(function(err, allPosts) {
            if (err) return cb ? cb(err): 0;
            
            var startIndex = pageNum*pageSize;
            var posts = allPosts.slice(startIndex, startIndex+pageSize);

            if (render) {
                this.renderPosts(posts, cb);
            } else {
                cb(0, posts);
            }
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

            if (render) {
                this.renderPosts(posts, cb);
            } else {
                cb(0, posts);
            }
        }, this));
    },
    
    getPost: function(slug, year, month, day, render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        this.getPostsByDay(year, month, day, _.bind(function(err, allPosts) {
            if (err) return cb ? cb(err) : 0;

            var posts = _.select(allPosts, function(post) {
                return post.slug == slug;
            });

            if (render) {
                this.renderPosts(posts, cb);
            } else {
                cb(0, posts);
            }
        }, this));
    },
    
    getPostsByGroup: function(groupName, render, cb) {
        if (typeof(render) == 'function') { cb = render; render = false; }

        this.getAllPosts(_.bind(function(err, allPosts, groupedPosts) {
            if (err) return cb ? cb(err) : 0;

            var posts = groupedPosts[groupName] || [];
            if (render) {
                this.renderPosts(posts, cb);
            } else {
                cb(0, posts);
            }
        }, this));
    },

    addTransform: function(transform) {
        this.transforms.push(transform);
    },

    matchTransform: function(url) {
        for (var i = 0; i < this.transforms.length; ++i) {
            var transform = this.transforms[i];
            var m = transform.pattern.exec(url);
            if (m) {
                return {groups: m.slice(1), transform: transform};
            }
        }
    },

    renderPost: function(post, cb) {
        // Replaces images with embeds
        var imageEmbedder = new ImageEmbedder(this);
        imageEmbedder.visit(post.tree);

        if (!imageEmbedder.embeds.length) {
            post.body = markdom.toHTML(post.tree);
            cb(0, post);
        } else {
            // Asynchronously render each of the embeds
            async.mapSeries(imageEmbedder.embeds,
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

        this.cache.load(key, 'embed', _.bind(function(err, result) {
            // console.log('cache?', body);

            if (err || !result) {
                console.log('render embed', key);
                embed.transform(post, _.bind(function(err, result) {
                    if (err) return cb(err);
                    
                    var jsonResult = JSON.stringify(result);
                    this.cache.store(key, result, 'embed');
                    post.attach.apply(post, result.attachments);
                    cb(0, result);
                }, this));
            } else {
                post.attach.apply(post, result.attachments);
                cb(0, result);
                
            }
        }, this));
    },
    
    // *********************************************************************************************

    _findContent: function(pattern, cb) {
        var directoryMap = {};
        glob.glob(pattern, 0, abind(function(err, matches) {
            async.map(matches, fs.lstat, abind(function(err, stats) {
                _.each(stats, ibind(function(stat, i) {
                    if (stat.isDirectory() && !directoryMap[matches[i]]) {
                        this.contentPaths.push({path: matches[i], all: true});
                        directoryMap[matches[i]] = true;
                    } else {
                        var parentDir = path.dirname(matches[i]);
                        if (!directoryMap[parentDir]) {
                            this.contentPaths.push({path: parentDir, all: true});
                            directoryMap[parentDir] = true;
                        }
                    }
                }, cb, this))
                cb(0);
            }, cb, this))
        }, cb, this));
    },

    _useSettings: function(settings, cb) {
        this.title = settings.title;
        this.link = settings.link;
        this.baseURL = settings.baseURL || '';
        this.hostName = settings.hostName;
        this.postsPerPage = settings.postsPerPage || 10;

        this.cache = new Cache(settings.cachePath, !!settings.cachePath, true, true);

        var logsPath = settings.logsPath || path.join(process.env.HOME, 'log.txt');
        mkdirsSync(path.dirname(logsPath));
        this.logPath = logsPath;

        if (settings.flickr) {
            var FlickrEmbedder = require('./FlickrEmbedder').FlickrEmbedder;
            this.addTransform(new FlickrEmbedder(settings.flickr.key, settings.flickr.secret));
        }

        if (settings.passwordPath) {
            this.passwordPath = settings.passwordPath;
            fs.readFile(settings.passwordPath, _.bind(function(err, data) {
                if (!err) {
                    this.password = (data+'').trim();
                }
            }, this));
        }

        this.getAllPosts(abind(function(err, posts) {
            _.each(this.contentPaths, ibind(function(item) {
                this.monitor(item.path);
            }, cb, this));
            cb(0);
        }, cb, this));        
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

                currentPost = new Post(this);
                currentPost.title = info.title;
                currentPost.slug = slug;
                currentPost.mtime = fileStat.mtime;
                currentPost.path = filePath;
                currentPost.url = relativeURL;//urlJoin(this.baseURL, relativeURL);
                currentPost.date = info.date;
                currentPost.group = info.group;
                currentPost.tree = new markdom.nodeTypes.NodeSet([]);
                posts.push(currentPost);
            } else if (currentPost) {
                currentPost.tree.nodes.push(node);
            }
        }

        if (cb) cb(0, posts);
    },
    
    _parseHeader: function(header) {
        var reTitle = /(.*?)\s*\[(.*?)\]/;
        var m = reTitle.exec(header);
        if (m && m[2]) {
            var date = new Date(m[2]);
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
            return a.date > b.date ? -1 : 1;
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
