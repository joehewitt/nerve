
var _ = require('underscore');
var markdom = require('markdom'),
    Span = markdom.nodeTypes.Span,
    NodeSet = markdom.nodeTypes.NodeSet;

// *************************************************************************************************

function PostSummarizer(blog) {
    this.blog = blog;
}

PostSummarizer.prototype = _.extend(new markdom.NodeTransformer(), {
    paragraph: function(node) {
        if (!this.summary) {
            var text = node.toText();
            var stripped = text.replace(/\s/g, '');
            if (stripped.length) {
                this.summary = text;
            }
        }
        return node;
    },
});

exports.PostSummarizer = PostSummarizer;
