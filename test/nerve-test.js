var path = require('path'),
    assert = require('assert'),
    vows = require('vows'),
    _ = require('underscore'),
    datetime = require('datetime');

require.paths.unshift(path.join(__dirname, '..', 'lib'));

var nerve = require('nerve');

// *************************************************************************************************

function createBlog(pattern) {
    return function() {
        var appPath = path.join(__dirname, 'blogs/a');
        var contentPath = path.join(__dirname, pattern);
        var blog = new nerve.Blog({
            app: appPath,
            content: contentPath
        }, _.bind(function(err, app) {
            // if (err) { console.trace(err.stack); this.callback(err); return; }
            this.callback(0, blog);
        }, this));    
    }
}

var blogTests = {
    topic: function(blog) {
        blog.getAllPosts(this.callback);
    },

    'of length 3': function(posts) {
        assert.equal(posts.length, 3);            
    },            

    'with titles': function(posts) {
        assert.equal(posts[0].title, 'Post Uno');
        assert.equal(posts[1].title, 'Post Duo');
        assert.equal(posts[2].title, 'Title');
    },            

    'with dates': function(posts) {
        assert.equal(datetime.format(posts[0].date, '%Y/%m/%d'), '2011/08/03');
        assert.equal(datetime.format(posts[1].date, '%Y/%m/%d'), '2011/08/02');
        assert.equal(datetime.format(posts[2].date, '%Y/%m/%d'), '2011/08/01');
    },
       
    'with group': function(err, posts) {
        assert.equal(posts[0].blog.groupedPosts.about[0].title, 'Me');
    },            
};

// *************************************************************************************************

vows.describe('nerve basics').addBatch({
    'A blog with wildcard content': {
        topic: createBlog('blogs/*.md'),
        'has posts': blogTests,
    },     
    'A blog with directory content': {
        topic: createBlog('blogs/b'),
        'has posts': blogTests,
    },     
}).export(module);
