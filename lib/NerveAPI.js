
var apijs = require('api.js'),
	API = apijs.API,
	method = apijs.method,
	_ = require('underscore');

// *************************************************************************************************

var NerveAPI = API(function(blog, apiPath) {
	arguments.callee.super_.call(this, apiPath);
	this.blog = blog;
}, {

});

exports.NerveAPI = NerveAPI;

NerveAPI.GET("auth",
"Authenticates the user.",
function(query, cookies, cb) {
    this.blog.checkPassword(query.pass, _.bind(function(err, passed) {
        if (passed) {
            var response = {};
            response.cookies = [['token', query.pass, {path: '/', maxAge: 99999999999}]];
            response.doNotCache = true;
            response.body = "You're in.";
            cb(0, response);
        } else {
            cb({error: 401, description: "Not authorized."})
        }
    }, this));
});

NerveAPI.GET("posts",
"Gets an array of posts with shortened properties.",
function(page, query, cb) {
    var view = query.view || 'all';
    var render = view == 'all';
	returnPosts(view || 'all', false, cb, _.bind(function(next) {
	    if (page !== undefined) {
	        var pageNum = page ? parseInt(page)-1 : 0;
	        this.blog.getPostsByPage(pageNum, this.blog.postsPerPage, render, next);
	    } else {
	        this.blog.getAllPosts(render, next);
	    }
	}, this));
});

NerveAPI.GET("group",
"Gets an array of posts contained by a group.",
function(group, query, cookies, cb) {
    var view = query.view || 'all';
    var render = view == 'all';
    if (group == "drafts") {
        this.blog.checkPassword(cookies.token||'', _.bind(function(err, passed) {
            if (passed) {
                returnPosts(view || 'all', false,
                function(err, result) {
                    if (err) {
                        cb(err);
                    } else {
                        result.doNotCache = true;
                        cb(0, result);
                    }
                },
                _.bind(function(next) {
                    this.blog.getPostsByGroup("drafts", render, next);
                }, this));
            } else {
                cb({error: 401, description: "Not authorized."})
            }
        }, this));
    } else {
    	returnPosts(view || 'all', true, cb, _.bind(function(next) {
    	    this.blog.getPostsByGroup(group, render, next);
    	}, this));
    }
});

NerveAPI.GET("post",
"Gets a single post by its unique identifier.",
function(year, month, day, slug, query, cb) {
    var view = query.view || 'all';
    var render = view == 'all';
	returnPosts(view || 'all', false, cb, _.bind(function(next) {
	    this.blog.getPost(slug, year, month, day, render, next);
	}, this));
});

// *************************************************************************************************

function returnPosts(format, errorIfEmpty, cb, postGetter) {
    postGetter(function(err, posts) {
        if (err) {
            cb({error: err.error ||  500, description: err.description || err+''});
        } else if (errorIfEmpty && !posts.length) {
            cb({error: 404, description: "Not Found"});
        } else {
            var result = {};
            var clientPosts = postsForClient(posts, format);
            result.body = JSON.stringify(clientPosts);
            var deps = _.map(posts, function(post) { return {mtime: post.mtime.getTime()} });
            result.etag = findLatestMtime(deps || []);
            // result.cacheControl = 'public, max-age=31536000';
            result.cacheControl = 'public, max-age=0';

            cb(0, result);
        }
    });
}

function findLatestMtime(dependencies) {
    var maxTime = 0;
    _.each(dependencies, function(dep) {
        if (dep.mtime > maxTime) {
            maxTime = dep.mtime;
        }
    });
    return maxTime;
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
               attachments: post.attachments,
               stylesheets: post.stylesheets
            });            
        }
    }
    return {posts: clientPosts};
}
