
var markdom = require('markdom');
var flickr = require('flickr-reflection');
var _ = require('underscore');

// ************************************************************************************************

function FlickrEmbedder(key, secret) {
	this.key = key;
	this.secret = secret;
}
exports.FlickrEmbedder = FlickrEmbedder;

FlickrEmbedder.prototype = {
    pattern: /http:\/\/.*?\.flickr\.com\/photos\/(.*?)\/(.*?)\//,

    authenticate: function(cb) {
    	if (this.api) {
    		cb(0, this.api);
    	} else if (this.authenticators) {
    		this.authenticators.push(cb);
    	} else {
    		this.authenticators = [cb];
			var options = {key: this.key, secret: this.secret, apis: ['photos']};
			console.log('Authenticating Flickr...')
			flickr.connect(options, _.bind(function(err, api) {
				if (err) { _.map(this.authenticators, function(cba) { cba(err) }); return; }

				this.api = api;
				_.map(this.authenticators, function(cba) { cba(0, api); });
				this.authenticators = null;
			}, this));
    	}
    },

	transform: function(userId, photoId, url, title, alt, cb) {
		this.authenticate(_.bind(function(err, api) {
			if (err) return cb ? cb(err) : 0;

			api.photos.getSizes({photo_id: photoId}, _.bind(function(err, data) {
		        if (err) return cb ? cb(err) : 0;

		        var metadata = {};
		        for (var i = 0; i < data.sizes.size.length; ++i) {
		            var sizeInfo = data.sizes.size[i];
		        	if (sizeInfo.label == "Thumbnail") {
		        		metadata.thumb = sizeInfo.source;
		        	} else if (sizeInfo.label == "Medium") {
		        		metadata.small = sizeInfo.source;
		        	} else if (sizeInfo.label == "Large") {
		        		metadata.large = sizeInfo.source;
		        	}
		            // if (sizeInfo.width > 800) {
			           //  var newImage = new markdom.nodeTypes.Image(sizeInfo.source);
			           //  newImage.width = sizeInfo.width;
			           //  newImage.height = sizeInfo.height;
			           //  // var newLink = new markdom.nodeTypes.Link(url, null, newImage);
			           //  var newLink = new markdom.nodeTypes.Link(sizeInfo.source);
			           //  newLink.className = 'flickrLink';
		            //     cb(0, newLink);
		            //     break;
		            // }
		        }

            	var metadataJSON = JSON.stringify(metadata);
            	var script = new markdom.nodeTypes.Script('uponahill/photo', metadataJSON);
                cb(0, script);
		    }, this));
	    }, this)); 	
	}
};
