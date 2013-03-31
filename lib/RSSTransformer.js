
var _ = require('underscore');
var markdom = require('markdom'),
    Span = markdom.nodeTypes.Span,
    NodeSet = markdom.nodeTypes.NodeSet;

// *************************************************************************************************

function RSSTransformer(blog) {
    this.blog = blog;
}

RSSTransformer.prototype = _.extend(new markdom.NodeTransformer(), {
    visit: function(node) {
        if (node.classes && node.classes.indexOf('widget') != -1) {
            return new Span(new NodeSet());
        } else {
            if (node.classes && node.classes.indexOf('float-right') != -1) {
                node.setStyle('float', 'right');
                node.setStyle('margin', '0 0 8px 8px');
            }

            return markdom.NodeTransformer.prototype.visit.apply(this, [node]);
        }
    }
});

exports.RSSTransformer = RSSTransformer;
