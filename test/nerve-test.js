var path = require('path'),
    assert = require('assert'),
    vows = require('vows'),
    _ = require('underscore'),
    datetime = require('datetime'),
    appjs = require('app.js');

require.paths.unshift(path.join(__dirname, '..', 'lib'));

var nerve = require('nerve');

// *************************************************************************************************

function createBlog(pattern) {
    return function() {
        var blogsPath = path.join(__dirname, 'blogs');
        var appPath = path.join(blogsPath, 'a');
        var clientPath = path.join(appPath, 'client.js');
        appjs.searchScript(appPath, _.bind(function(err, result) {
            if (err) { console.trace(err.stack); this.callback(err); return; }

            var app = new appjs.App({
                title: "Test",
                client: clientPath
            });

            app.paths.push(blogsPath);

            var contentPath = path.join(__dirname, pattern);
            var blog = new nerve.Blog({
                content: contentPath,
                host: 'example.com',
            });

            blog.useApp(app, _.bind(function(err) {
                if (err) { console.trace(err.stack); this.callback(err); return; }
                this.callback(0, blog);
            }, this));
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

    'basic paragraph': function(posts) {
        assert.equal(posts[0].body, '<p>This is a post.</p>');
    },

    'image': function(posts) {
        assert.equal(posts[1].body,
            '<p><img src="http://example.com/content/images/salvia.jpg/200x100" title="The title" width="200" height="100"></p>'
        );
    },

    'ignore style in the middle': function(posts) {
        assert.equal(posts[2].body,
            '<p class="styled post">This is text. (.ignore.this) This is more text.</p>'
        );
    },

    'parentheses that are not a style': function(posts) {
        assert.equal(posts[3].body,
            '<p>This is a line (and this is not styling)</p>'
        );
    },

    'list item': function(posts) {
        assert.equal(posts[4].body,
            '<ul><li class="styled">This is a list item</li></ul>'
        );
    },

    'blockquote': function(posts) {
        assert.equal(posts[5].body,
            '<blockquote><p class="styled">This is a blockquote\nand it is</p></blockquote>'
        );
    },

    'code block': function(posts) {
        assert.equal(posts[6].body,
            '<pre class="styled"><code>This is a code block\nand it is</code></pre>'
        );
    },

    'simple span': function(posts) {
        assert.equal(posts[7].body,
            '<p>This is an <span class="styled">example of how</span> spans can be styled.</p>'
        );
    },

    'complex span': function(posts) {
        assert.equal(posts[8].body,
            '<p>This is an <span class="styled">example of complex content <img src="http://foo.com/foo.jpg"></span> inside a styled span.</p>'
        );
    },

    'span with title': function(posts) {
        assert.equal(posts[9].body,
            '<p>This is a <span class="styled" title="the title">span with a title</span>.</p>'
        );
    },

    'styled block': function(posts) {
        assert.equal(posts[10].body,
            '<p>Monkey see.</p><div class="section"><p>One banana.</p><p>Two bananas.</p></div><p>Monkey do.</p>'
        );
    },

    'nested styled block': function(posts) {
        assert.equal(posts[11].body,
            '<p>Monkey see.</p><div class="section"><p>One banana.</p><div class="nested"><p>1.5 banana</p></div><p>Two bananas.</p></div><p>Monkey do.</p>'
        );
    },

    'figure names': function(posts) {
        assert.equal(posts[12].body,
            '<p class="figure" require="a/fig" figure="fig">Simple figure.</p><p class="figure" require="a/fig" figure="bar">Figure with slash.</p><p class="figure" require="example.com" figure="example.com">Figure with dot.</p><p class="figure" require="example.com" figure="bar">Figure with dot and slash.</p><p class="foo bar figure" require="example.com" figure="example.com">Figure and class names.</p><p class="figure figureNotFound">Figure not found.</p>'
        );
    },

    'multi-line paragraph': function(posts) {
        assert.equal(posts[13].body,
            '<p class="line2">Line 1 (.line1)\nLine 2</p>'
        );
    },

    'css import': function(posts) {
        assert.deepEqual(posts[14].stylesheets, ['/app.js/static/a/foofy.css']);
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
