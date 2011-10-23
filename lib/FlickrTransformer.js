
var flickr = require('flickr-reflection');
var _ = require('underscore');

// ************************************************************************************************

function FlickrTransformer(key, secret) {
	this.key = key;
	this.secret = secret;
}
exports.FlickrTransformer = FlickrTransformer;

FlickrTransformer.prototype = {
    pattern: /http:\/\/.*?\.flickr\.com\/photos\/(.*?)\/(.*?)\/?$/,

    authenticate: function(cb) {
    	if (this.api) {
    		cb(0, this.api);
    	} else if (this.authenticators) {
    		this.authenticators.push(cb);
    	} else {
    		this.authenticators = [cb];
			var options = {key: this.key, secret: this.secret, apis: ['photos']};
			D&&D('Authenticating Flickr...')
			flickr.connect(options, _.bind(function(err, api) {
				if (err) { _.map(this.authenticators, function(cba) { cba(err) }); return; }

				this.api = api;
				_.map(this.authenticators, function(cba) { cba(0, api); });
				this.authenticators = null;
			}, this));
    	}
    },

	transform: function(post, userId, photoId, url, title, alt, query, cb) {
		this.authenticate(_.bind(function(err, api) {
			if (err) return cb ? cb(err) : 0;

			api.photos.getSizes({photo_id: photoId}, _.bind(function(err, data) {
		        if (err) return cb ? cb(err) : 0;

		        var attachment = {};
		        for (var i = 0; i < data.sizes.size.length; ++i) {
		            var sizeInfo = data.sizes.size[i];
		        	if (sizeInfo.label == "Thumbnail") {
		        		attachment.thumb = sizeInfo.source;
		        	} else if (sizeInfo.label == "Medium") {
		        		attachment.small = sizeInfo.source;
		        	} else if (sizeInfo.label == "Large") {
		        		attachment.large = sizeInfo.source;
		        	}
		        }

                cb(0, {attachments: [attachment]});
		    }, this));
	    }, this)); 	
	}
};
