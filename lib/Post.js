
var markdom = require('markdom');
var datetime = require('datetime');

// *************************************************************************************************

function Post(blog) {
    this.blog = blog;
}

Post.prototype = {
    get isChronological() {
        return !!this.date;    
    },

    attach: function() {
    	if (!this.attachments) {
    		this.attachments = [];
    	}

        this.attachments.push.apply(this.attachments, arguments);
    }
};

exports.Post = Post;
