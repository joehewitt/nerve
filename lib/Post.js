
var markdom = require('markdom');
var datetime = require('datetime');

// *************************************************************************************************

function Post(blog) {
    this.blog = blog;
}

Post.prototype = {
    get prettyDate() {
        return this.date ? datetime.format(new Date(this.date), '%B %e%k, %Y') : 'March 30th, 2013';
    },

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
