var path = require('path'),
    assert = require('assert'),
    vows = require('vows');

require.paths.unshift(path.join(__dirname, '..', 'lib'));

var nerve = require('nerve');

// *************************************************************************************************

vows.describe('nerve basics').addBatch({
    'A blog': {
        topic: new nerve.Blog(path.join(__dirname, 'blogs/a'), 'http://example.com'),

        'has posts': {
            topic: function(blog) {
                blog.getAllPosts(this.callback);
            },

            'of length 3': function(posts) {
                assert.equal(posts.length, 3);            
            },            

            'with titles': function(posts) {
                assert.equal(posts[0].title, 'Title');
                assert.equal(posts[1].title, 'Post Duo');
                assert.equal(posts[2].title, 'Post Uno');
            },            
        }
        
    },     
}).export(module);
