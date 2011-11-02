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
            content: contentPath,
            host: 'example.com',
        }, _.bind(function(err, app) {
            if (err) { console.trace(err.stack); this.callback(err); return; }
            this.callback(0, blog);
        }, this));    
    }
}

var postTests = {
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


var contentTests = {
    topic: function(blog) {
        blog.getAllPosts(true, this.callback);
    },

    'test1': function(posts) {
        assert.equal(posts[0].body, '<p>This is a post.</p>');
    },

    'test2': function(posts) {
        assert.equal(posts[1].body,
            '<p><img src="http://example.com/content/images/salvia.jpg/200x100" title="The title" width="200" height="100"></p>'
        );
    },

    'test3': function(posts) {
        assert.equal(posts[1].body,
            '<p><img src="http://example.com/content/images/salvia.jpg/200x100" title="The title" width="200" height="100"></p>'
        );
    },
};

// *************************************************************************************************

vows.describe('nerve basics').addBatch({
    'A blog with wildcard content': {
        topic: createBlog('blogs/*.md'),
        'has posts': postTests,
    },     
    'A blog with directory content': {
        topic: createBlog('blogs/b'),
        'has posts': postTests,
    },     
    'A blog': {
        topic: createBlog('blogs/c'),
        'with content': contentTests,
    },     
}).export(module);
