
var _ = require('underscore');
var markdom = require('markdom');

// *************************************************************************************************

function ImageEmbedder(blog) {
    this.blog = blog;
    this.embeds = [];
}

ImageEmbedder.prototype = _.extend(new markdom.NodeTransformer(), {
    image: function(node) {
        var m = this.blog.matchTransform(node.url);
        if (m) {
            var embed = new markdom.nodeTypes.Embed(node.url, node.title, node.alt, m.groups, m.transform);
            this.embeds.push(embed);
            return embed;
        } else {
            return node;
        }
    },
});

exports.ImageEmbedder = ImageEmbedder;
