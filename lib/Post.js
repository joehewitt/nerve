
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
};

exports.Post = Post;
