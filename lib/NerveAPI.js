
var apijs = require('apijs'),
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

NerveAPI.GET("page",
"Gets an array of posts with all properties.",
function(page, query, cb) {
	returnPosts('all', false, cb, _.bind(function(next) {
	    var pageNum = page ? parseInt(page)-1 : 0;
	    this.blog.getPostsByPage(pageNum, this.blog.postsPerPage, true, next);
	}, this));
	
});

NerveAPI.GET("posts",
"Gets an array of posts with shortened properties.",
function(page, params, cb) {
	returnPosts('links', false, cb, _.bind(function(next) {
	    if (page !== undefined) {
	        var pageNum = page ? parseInt(page)-1 : 0;
	        this.blog.getPostsByPage(pageNum, this.blog.postsPerPage, true, next);
	    } else {
	        this.blog.getAllPosts(next);
	    }
	}, this));
});

NerveAPI.GET("group",
"Gets an array of posts contained by a group.",
function(group, query, cb) {
	if (group == "drafts") {
	    if (this.blog.checkPassword(query.pass)) {
	        returnPosts('all', false, cb, _.bind(function(next) {
	            this.blog.getPostsByGroup("drafts", true, next);
	        }, this));
	    } else {
	        cb({error: 404, description: "Not found."})
	    }
	} else {
		returnPosts('links', true, cb, _.bind(function(next) {
		    this.blog.getPostsByGroup(group, true, next);
		}, this));
	}
});

NerveAPI.GET("post",
"Gets a single post by its unique identifier.",
function(year, month, day, slug, cb) {
	returnPosts('all', false, cb, _.bind(function(next) {
	    this.blog.getPost(slug, year, month, day, true, next);
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
            result.cacheControl = 'public, max-age=31536000';
            // result.cacheControl = 'public, max-age=0';

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
               attachments: post.attachments
            });            
        }
    }
    return {posts: clientPosts};
}
