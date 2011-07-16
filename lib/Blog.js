
var fs = require('fs');
var path = require('path');
var URL = require('url');
var events = require('events');
var Step = require('step');
var async = require('async');
var _ = require('underscore');
var markdom = require('markdom');
var datetime = require('datetime');
var mkdirsSync = require('mkdir').mkdirsSync;
var DiskCache = require('diskcache').DiskCache;
var Post = require('./Post').Post;
var ImageEmbedder = require('./ImageEmbedder').ImageEmbedder;
var abind = require('dandy/errors').abind;

// *************************************************************************************************

var rePostFileName = /(\d{4})-(\d{2})-(\d{2}).(md|markdown)/;

// *************************************************************************************************

function Blog(appPath, contentPath, settings) {
    events.EventEmitter.call(this);

    this.appPath = appPath;
    this.contentPath = contentPath;
    this.title = settings.title;
    this.link = settings.link;
    this.baseURL = settings.baseURL || '';
    this.hostName = settings.hostName;
    this.postsPerPage = settings.postsPerPage || 10;
    this.transforms = [];

    this.monitor(contentPath);

    var cachePath = settings.cachePath || path.join(contentPath, 'cache');
    this.diskCache = new DiskCache(cachePath, true, true, true);

    if (settings.logsPath) {
        var logsPath = path.dirname(settings.logsPath)
        mkdirsSync(logsPath);
        this.logPath = settings.logsPath;
    } else {
         var logsPath = path.join(contentPath, 'logs');
        mkdirsSync(logsPath);
        this.logPath = path.join(logsPath, 'log.txt');
    }

    if (settings.flickr) {
        var FlickrEmbedder = require('./FlickrEmbedder').FlickrEmbedder;
        this.addTransform(new FlickrEmbedder(settings.flickr.key, settings.flickr.secret));
    }

    this.getAllPosts(function(err, posts) {
        if (err) {
            console.log(err);
            console.trace(err);
        }
    });
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
    monitor: function(articlesPath) {
        fs.watchFile(articlesPath, {}, _.bind(function() {
            try {
                this.invalidate();
            } catch (exc) {
                console.log(exc.stack);
            }
        }, this));
    },
    
    normalizeURL: function(url) {
        return URL.resolve(this.baseURL, url);
    },

    invalidate: function() {
        if (!this.posts) return;

        this.statPosts(_.bind(function(err, statMap) {
            if (err) return;

            var postMap = {};
            this.posts.forEach(function(post) {
               if (post.contentPath in postMap) {
                    postMap[post.path].push(post);
                } else {
                    postMap[post.path] = [post];
                }
            });

            _.each(statMap, _.bind(function(mtime, filePath) {
                if (!postMap[filePath]) {
                    this._parsePostsFile(path.basename(filePath), _.bind(function(err, posts) {
                        this.posts.push.apply(this.posts, posts);
                        this._assignPosts(this.posts);

                        posts.forEach(_.bind(function(post) {
                            this.emit('postCreated', post);
                        }, this));
                    }, this));
                } else {
                    var previousPosts = postMap[filePath];
                    var previousPost = previousPosts[0];
                    if (mtime > previousPost.mtime) {
                        this._parsePostsFile(path.basename(filePath), _.bind( function(err, posts) {
                            if (err) return;

                            posts.forEach(_.bind(function(newPost, index) {
                                if (this._syncPost(newPost)) {
                                    this.emit('postChanged', newPost);
                                } else {
                                    this.emit('postCreated', newPost);
                                }
                                var oldPost = _.detect(previousPosts, function(post) {
                                    return post.slug == newPost.slug;
                                });
                                if (oldPost) {
                                    var index = previousPosts.indexOf(oldPost);
                                    previousPosts.splice(index, 1);
                                }
                            }, this));

                            _.each(previousPosts, _.bind(function(oldPost) {
                                this._removePost(oldPost);
                                this.emit('postDeleted', oldPost);
                            }, this));

                        }, this));
                    }
                    delete postMap[filePath];
                }
           }, this));

           _.each(postMap, _.bind(function(posts, path) {
                _.each(posts, _.bind(function(post) {
                    var index = this.posts.indexOf(post);
                    this.posts.splice(index, 1);
                    this.emit('postDeleted', post);
                }, this));
           
                this._assignPosts(this.posts);
           }, this));
        }, this));
    },

    statPosts: function(cb) {
        var blog = this;
        var articlePaths;

        Step(
        function() {
            fs.readdir(blog.contentPath, this);
        },
        function(err, fileNames) {
            if (err) return cb ? cb(err): 0;

            articlePaths = _.map(fileNames, function(fileName) {
                return path.join(blog.contentPath, fileName);
            });

            var stats = this.group();
            _.each(articlePaths, function(articlePath) {
                fs.lstat(articlePath, stats());
            });
        },
        function(err, stats) {
            if (err) return cb ? cb(err): 0;

            var statMap = {};
            _.each(stats, function(stat, i) {
                statMap[articlePaths[i]] = stat.mtime;
            });
            cb(0, statMap);
        });
    },
     
    getAllPosts: function(cb) {
        if (!this.posts) {
            this._reload(cb);
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

        this.diskCache.load(key, 'embed', _.bind(function(err, result) {
            // console.log('cache?', body);

            if (err || !result) {
                console.log('render embed', key);
                embed.transform(post, _.bind(function(err, result) {
                    if (err) return cb(err);
                    
                    var jsonResult = JSON.stringify(result);
                    this.diskCache.store(key, result, 'embed');
                    post.attach.apply(post, result.attachments);
                    cb(0, result);
                }, this));
            } else {
                post.attach.apply(post, result.attachments);
                cb(0, result);
                
            }
        }, this));
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    
    _reload: function(cb) {
        var blog = this;
        var articleFileNames, articleFiles;

        fs.readdir(blog.contentPath, function(err, fileNames) {
            if (err) return cb ? cb(err): 0;

            var filePaths = _.map(fileNames, function(fileName) {
                return path.join(blog.contentPath, fileName);
            });
            async.map(filePaths, fs.lstat, function(err, fileStats) {
                if (err) return cb ? cb(err): 0;

                fileNames = _.reject(fileNames, function(name, i) { return fileStats[i].isDirectory(); });
                filePaths = _.reject(filePaths, function(path, i) { return fileStats[i].isDirectory(); });
                fileStats = _.reject(fileStats, function(stat, i) { return stat.isDirectory(); });

                async.map(filePaths,
                    function(filePath, cb2) {
                        fs.readFile(filePath, 'utf8', cb2);
                    },
                    function(err, fileBodies) {
                        if (err) return cb ? cb(err): 0;

                        var i = 0;
                        async.map(fileBodies,
                            function(fileBody, cb2) {
                                blog._parsePosts(fileBody, fileNames[i], fileStats[i], cb2);
                                ++i;
                            },
                            function(err, postFiles) {
                                if (err) return cb ? cb(err): 0;

                                var posts = [];
                                postFiles.forEach(function(filePosts) {
                                    posts.push.apply(posts, filePosts);
                                });

                                blog._assignPosts(posts);

                                if (cb) cb(0, blog.datedPosts, blog.groupedPosts);
                            }
                        );
                    });
            });
        });
    },
    
    _parsePostsFile: function(fileName, cb) {
        fs.readFile(path.join(this.contentPath, fileName), 'utf8', _.bind(function(err, fileBody) {
            this._statAndParsePosts(fileBody, fileName, cb);
        }, this));
    },

    _statAndParsePosts: function(fileBody, fileName, cb) {
        fs.lstat(path.join(this.contentPath, fileName), _.bind(function(err, stat) {
            this._parsePosts(fileBody, fileName, stat, cb);
        }, this));
    },
    
    _parsePosts: function(fileBody, fileName, fileStat, cb) {
        var tree = markdom.toDOM(fileBody);

        var m  = rePostFileName.exec(fileName);
        var postSlug, postDate, postGroup;
        if (m) {
            postSlug = m[1] + '/' + m[2] + '/' + m[3];
            postDate = new Date(m[2] + '/' + m[3] + '/' + m[1]);
        } else {
            postSlug = path.basename(fileName, '.md');
            postGroup = postSlug;
        }
    
        var posts = [];
        var currentPost;
        for (var j = 0; j < tree.nodes.length; ++j) {
            var node = tree.nodes[j];
            if (node instanceof markdom.nodeTypes.Header && node.level == 1) {
                var title = node.content.toHTML();
                var slug = title.toLowerCase().split(/\s+/).join('-');
                slug = slug.replace(/[^a-z0-9\-]/g, '');
                var relativeURL = postGroup ? postSlug : postSlug + '/' + slug;
                currentPost = new Post(this);
                currentPost.title = title;
                currentPost.slug = slug;
                currentPost.mtime = fileStat.mtime;
                currentPost.path = path.join(this.contentPath, fileName);
                currentPost.url = urlJoin(this.baseURL, relativeURL);
                currentPost.date = postDate;
                currentPost.group = postGroup;
                currentPost.tree = new markdom.nodeTypes.NodeSet([]);
                posts.push(currentPost);
            } else if (currentPost) {
                currentPost.tree.nodes.push(node);
            }
        }

        if (cb) cb(0, posts);
    },
    
    _syncPost: function(newPost) {
        var oldPost = _.detect(this.posts, function(post) {
            return post.path == newPost.path && post.slug == newPost.slug;
        });
        if (oldPost) {
            this._removePost(oldPost, newPost);
            return true;
        } else {
            this.posts.push(newPost);
            this._assignPosts(this.posts);
            return false;
        }
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