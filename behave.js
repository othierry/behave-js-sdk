'use strict';

(function(window, document) {

if (!window.behave) {
  var behave = (window.behave = {});

  // API endpoint
  behave.API_ROOT = 'http://api.behave.io';

  // Designated initializer
  // Must be called with valid access token before any another methods
  // @param string token : Your API token
  // @param options object : Optional options that may include:
  //    -> handlesTrackingResponse (boolean) : True by default, if set to true
  //       the track() response will be automatically handled if not custom callback is given
  //       If a badge has been unlocked, the default UI will be triggered showing the unlocked badge
  //       to the user. You should set to false if you want to display custom UI for showing rewards and
  //       feedbacks.
  behave.init = function(token, options) {
    behave.token = token;
    behave.options = options || {};
    behave.requestQueue = behave.queue(function(request, callback) {
      if (request.params && (request.method === 'POST' || request.method === 'PUT')) {
        request.params = JSON.stringify(request.params);
      }
      $.ajax({
        url: behave.API_ROOT + (typeof(request.path) == 'function' ? request.path() : request.path),
        type: request.method || 'GET',
        data: request.params,
        headers: {
          'X-Behave-Api-Token': behave.token,
          'Content-Type': 'application/json'
        }
      }).done(function(data, textStatus, jqXHR) {
        callback(null, data);
      }).fail(function(jqXHR, textStatus, errorThrown) {
        callback(errorThrown, null);
      });
    });

    // Fetch app public info
    behave.requestQueue.push({
      path: '/app/info',
    }, behave.responseHandler(function(err, app) {
      if (err) {
        console.error("Failed to fetch app info");
      } else {
        behave.app = app;
      }
    }));
  };


  // This identify the current user.
  // This method MUST be called before tracking any of the user behaviours
  //
  // @param userId string : The unique user ID in your database - It must be unique.
  // @param traits object (optional) : Custom attributes to populate the profile of your player.
  //        There are 3 special traits attributes:
  //            -> language (string) : fr_FR, en_US, en_UK, etc... it will be used to automatically localize
  //               the rewards!
  //            -> name (string) : The name of the user (used for display in backoffice for example)
  //            -> picture (string url) : The url of the user picture (used for display in backoffice for example)
  //
  // @note: You can call this method multiple times if you want to update the traits (custom attributes)
  // of the player.
  behave.identify = function(userId, traits, callback) {
    callback =  (typeof traits === 'function' ? traits : callback);
    traits   =  (typeof traits === 'object'   ? traits : {});
    behave.player = userId;
    behave.requestQueue.push({
      path: '/players/' + userId + '/identify',
      method: 'POST',
      params: {
        traits: traits,
      }
    }, behave.responseHandler(callback));
  };

  // Track a player's behaviour
  // @param behaviour string : The behaviour (e.g "Did purchase pack" or "did-purchase-pack" to avoid mistyping)
  // @param context object (optional) : THe context in which this action was taken. Use this parameter to provide ANY
  // custom data you may use in your recipes as filters. It is good practice to always describe to context when possible.
  behave.track = function(behaviour, context, callback) {
    if (!behave.player) {
      return callback("behave.identify() must be called before tracking any of the player's behaviours.");
    }

    callback = (typeof context === 'function' ? context : callback);
    context  = (typeof context === 'object'   ? context : null);

    if (!callback && behave.options.handlesTrackingResponse !== false) {
      callback = behave.displayBadgeIfNeeded;
    }

    behave.requestQueue.push({
      path: '/players/' + behave.player + '/track',
      method: 'POST',
      params: {
        verb: behaviour,
        context: context
      }
    }, behave.responseHandler(callback));
  };

  // Fetch the current player badges (owned)
  // @param callback function : The callback
  behave.fetchPlayerBadges = function(callback) {
    if (!behave.player) {
      return callback("behave.identify() must be called before tracking any of the player's behaviours.");
    }
    behave.requestQueue.push({
      path: '/players/' + behave.player + '/track',
    }, behave.responseHandler(callback))
  }

  // Fetch ALL the leaderboard results FOR the current player
  // It will return all the leaderboards the player is currently in.
  // @param options object (optional) : fetch options
  //    - leaderboards (Array) : reference_id(s) of leaderboard to fetch result from (all by default)
  //    - max (Number) : if specified (>0) the leaderboards when the player's position is > max will be
  //      ignored.
  // @param callback function : callback
  behave.fetchLeaderboardResultsForPlayer = function(options, callback) {
    if (!behave.player) {
      return callback("behave.identify() must be called before tracking any of the player's behaviours.");
    }

    callback = (typeof options === 'function' ? options : callback);
    options  = (typeof options === 'object'   ? options : {});

    options.player_id = behave.player;

    behave.requestQueue.push({
      path: '/leaderboards/player-results',
      method: 'POST',
      params: options,
    }, behave.responseHandler(callback));    
  }

  // Fetch a specific leaderboard result for the current player
  // @param leaderboardId string : The leaderboard's reference_id
  // @param options object (optional) : fetch iptions
  // @param callback function : callback
  behave.fetchLeaderboardResultForPlayer = function(leaderboardId, options, callback) {
    if (!behave.player) {
      return callback("behave.identify() must be called before tracking any of the player's behaviours.");
    }
 
    callback = (typeof options === 'function' ? options : callback);
    options  = (typeof options === 'object'   ? options : {});
   
    options.leaderboards = [leaderboardId];

    return behave.fetchLeaderboardResultsForPlayer(options, callback);
  }

  // Fetch a specific leaderboard results
  // @param leaderboardId string : The leaderboard's reference_id
  // @param options object (optional) : fetch options
  //     - player_id (reference_id) (Optional) : a player to ALWAYS include in the result (e.g the current player)
  //     - players (Array) : An array of players to only include in the results and discard the others
  //     - positions (String) (Optional) relative|absolute : Default to "absolute" - relative means positions relative to the
  //       selected players. Absolute means the positions between ALL players and not only selected players.
  //       "relative" is good when you want to make a leaderboard result only between a players and his/her friends.
  //     - page (Number) (Optional) : Default to 1.  
  //     - limit (Number) (Optional) : Default to 1000. 
  //     - max (Number) (Optional) : Default to 0 (None). if specified, only get the up the the maximum position (alias of limit)
  //     - context (object) : You can even restrict the results according to a specific context. Score will be calculated according
  //       to the behaviours that posted to the leaderboard under a context matching the given context.
  //       For example:
  //       context = { timestamp: '>42424242' } // Results only for date >42424242
  //       OR again:
  //       context = { timestamp: '<=42424242', placeId: '42', ... } // Results ont for date <=42424242 and when placeId was 42
  // @param callback function : callback
  behave.fetchLeaderboardResults = function(leaderboardId, options, callback) {
    callback = (typeof options === 'function' ? options : callback);
    options  = (typeof options === 'object'   ? options : {});
    
    options.limit = options.limit ? Math.min(1000, options.limit) : 1000
    options.offset = options.page ? (options.page - 1) * options.limit : 0;

    // Lower limit if "max position" option given and is lower than the limit   
    if (options.max && options.max < options.limit) {
      options.limit = options.max;
    }

    behave.requestQueue.push({
      path: '/leaderboards/' + leaderboardId + '/results',
      params: options
    }, behave.responseHandler(callback));
  };

  behave.iterateLeaderboardResults = function(leaderboardId, options, iterator, callback) {

    callback = (typeof options === 'function' ? iterator : callback);
    iterator = (typeof options === 'function' ? options  : iterator);
    options  = (typeof options === 'object'   ? options  : {});

    var page    = options.page  || 1;
    var limit   = options.limit || 1000;
    var max_pos = options.max   || 0;
    behave.fetchLeaderboardResults(leaderboardId, options, function(err, results) {
      if (results) {
        var total = (page - 1) * limit + results.length;
        var stop  = (results.length === 0);
        if (!stop) {
          if (max_pos > 0 && total > max_pos) {
            results = results.slice(0, results.length - (total - max_pos));
            stop = true;
          }
          iterator(results, page);
          if (!stop) {
            // Recursive
            options.page = page + 1;
            behave.iterateLeaderboardResults(leaderboardId, options, iterator, callback);
          } else if (callback) {
            callback();
          }
        } else if (callback) {
          callback();
        }
      }
    });
  }

  behave.responseHandler = function(callback) {
    return function(err, result) {
      if (callback) {
        if (err || result.error) return callback(err || result.error)
        callback(null, result.data);        
      }
    }
  }

  behave.displayBadgeIfNeeded = function(err, result) {
    if (result.badges.length) {
      behave.ui({
        method: 'dialog',
        badge: result.badges[0],
        facebook: {
          link: behave.app.url,
          caption: behave.app.name
        }
      });
    }
  }

  behave.queue = function(handler) {
    var operations = []
    return {
      push: function(operation, callback) {
        operations.push([operation, callback]);
        if (operations.length === 1) this.run();
      },

      run: function() {
        if (operations.length === 0) return;
        var self      = this;
        var operation = operations[0];
        handler(operation[0], function(err, result) {
          if (operation[1]) operation[1](err, result);
          operations = operations.slice(1, operations.length);
          self.run();
        })
      }
    }
  };

  behave.ui = function(options) {
    if (options.method == 'dialog') {
      return {

        showClass: 'bounceInDown',
        hideClass: 'bounceOutDown',

        facebookEnabled: options.facebook && window.FB,

        compile: function() {
          return "<div>"
               + "  <div class=\"modal-backdrop fade\"></div>"
               + "  <div style=\"text-align:center\" class=\"well span5 bh-dialog\">"
               + "    <legend style=\"text-align:center\">" + options.badge.name + " unlocked!</legend>"
               + "    <div>"
               + "      <img style=\"margin:auto;display:block\" "
               + "           class=\"img img-circle img-polaroid\" "
               + "           src=\""+ options.badge.icon + "\" "
               + "           width=\"100px\" "
               + "           height=\"100px\" />"
               + "    </div>"
               + "    <br>"
               + "    <p>"
               + "      " + options.badge.message
               + "    </p>"
               + "    <hr>"
               + (this.facebookEnabled ? "<div class=\"btn btn-facebook\" ng-click=\"shareOnFacebook()\"><i class=\"icon-facebook\"></i> | Share</a></div>" : "")
               + "    <div class=\"btn\" ng-click=\"close()\">" + (this.facebookEnabled ? 'Or close' : 'Close') + "</a></div>"
               + "  </div>"
               + "</div>";
        },

        open: function() {
          var self = this;

          // Compile and add element to the DOM
          self.el = $(self.compile()).appendTo('body');

          // backdrop
          self.el.children().eq(0).addClass('in');
 
          // popup
          self.el.children().eq(1).addClass('animated');
          self.el.children().eq(1).addClass(self.showClass);

          // Close
          self.el.children().eq(1).children().last().click(function(e){
            e.preventDefault();
            self.close();
          })

          // Share on facebook
          self.el.children().eq(1).children().last().prev().click(function(e){
            window.FB.ui({
              method: 'feed',
              name: options.badge.name,
              link: options.facebook.link || "",
              picture: options.badge.icon,
              caption: options.facebook.caption || "",
              description: options.badge.message
            })
          })
        },

        close: function() {
          var self = this;

          // backdrop
          self.el.children().eq(0).removeClass('in');
          // popup
          self.el.children().eq(1).removeClass(self.showClass);
          self.el.children().eq(1).addClass(self.hideClass);

          // Remove element from DOM after animation ended
          setTimeout(function() {
            self.el.remove();
          }, 500);
        },

        isOpen: function() {
          return this.el != null;
        }
      }.open();
    }
  }
}

})(window, document);