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
        // appPath, contentPath
        var conf = {
            'title': 'Test Blog',
            'host': 'testhost.example.net',
            'content': pattern
        };
        var blog = new nerve.Blog(conf);
        // blog.init('mac', {}, _.bind(function(err, app) {
        //     if (err) { console.trace(err.stack); this.callback(err); return; }
        //     this.callback(0, blog);
        // }, this));    
        return blog;
    }
}

var blogTests = {
    topic: function(blog) {
        blog.reload( _.bind(function() {
            blog.getAllPosts(this.callback);
        }, this) );
        // blog.getAllPosts(this.callback);
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
       
    // 'with group': function(err, posts, groupedPosts) {
    //     assert.equal(groupedPosts.about[0].title, 'Me');
    // },            
};

// *************************************************************************************************

vows.describe('nerve basics').addBatch({
    'A blog with wildcard content': {
        topic: createBlog('test/blogs/*.md'),
        'has posts': blogTests,
    } 
    , 'A blog with directory content': {
        topic: createBlog('test/blogs/b'),
        'has posts': blogTests,
    },     
}).export(module);

