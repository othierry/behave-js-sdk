'use strict';

(function(window, document) {

  var EventEmitter = function(eventNames) {
    var self = this;
    self.subscribers = {};
    eventNames.forEach(function(eventName) {
      self.subscribers[eventName] = [];
    });
  }

  EventEmitter.prototype.subscribe = function(event, callback) {
    var self = this;
    if (self.subscribers[event] && self.subscribers[event].indexOf(callback) === -1) {
      self.subscribers[event].push(callback);
      return true;
    }
    return false;
  };

  EventEmitter.prototype.unsubscribe = function(event, callback) {
    var self = this;
    if (self.subscribers[event]) {
      var index = self.subscribers[event].indexOf(callback);
      if (index === -1) {
        return false;
      }
      self.subscribers[event].slice(index, 1);
    }
    return false;
  };

  EventEmitter.prototype.publish = function(event, data) {
    var self = this;
    if (self.subscribers[event]) {
      self.subscribers[event].forEach(function(subscriber) {
        subscriber(data);
      }); 
      return true;
    }
    return false;
  };

  var Player = function(referenceId, traits) {
    this.referenceId = referenceId;
    this.points = 0;
    this.anonymous = true;
    this.traits = traits || {};
  };

  Player.prototype.isIdentified = function() {
    return this.referenceId != null;
  }

  Player.prototype.set = function(traitName, traitValue) {
    this.traits[traitName] = traitValue;
    behave.identify(this.referenceId, this.traits);
  };

  Player.prototype.get = function(traitName) {
    return this.traits[traitName];
  };

  // Fetch the current player badges (owned)
  // @param callback function : The callback
  Player.prototype.fetchBadges = function(callback) {
    if (!behave.assertPlayerIsIdentified(callback)) return;
    behave.fetchPlayerBadges(this.referenceId, callback);
  };

  // Fetch the current player locked badges (not owned)
  // @param callback function : The callback
  Player.prototype.fetchLockedBadges = function(callback) {
    if (!behave.assertPlayerIsIdentified(callback)) return;
    behave.fetchPlayerLockedBadges(this.referenceId, callback);
  };

  // Fetch ALL the leaderboard results FOR the current player
  // It will return all the leaderboards the player is currently in.
  // @param options object (optional) : fetch options
  //    - leaderboards (Array) : reference_id(s) of leaderboard to fetch result from (all by default)
  //    - max (Number) : if specified (>0) the leaderboards when the player's position is > max will be
  //      ignored.
  // @param callback function : callback
  Player.prototype.fetchLeaderboardResults = function(options, callback) {
    if (!behave.assertPlayerIsIdentified(callback)) return;
    behave.fetchPlayerLeaderboardResults(this.referenceId, options, callback);
  };

  // Fetch a specific leaderboard result for the current player
  // @param leaderboardId string : The leaderboard's reference_id
  // @param options object (optional) : fetch iptions
  // @param callback function : callback
  Player.prototype.fetchLeaderboardResult = function(leaderboardId, options, callback) {
    if (!behave.assertPlayerIsIdentified(callback)) return;
    behave.fetchPlayerLeaderboardResult(this.referenceId, leaderboardId, options, callback);
  };

  if (!window.behave) {
    var behave = (window.behave = {});
    behave.events = new EventEmitter(['player:identified', 'reward:points', 'reward:badge', 'reward:level']);
    behave.player = new Player(null);

    // API endpoint
    behave.API_ROOT = 'http://api.behave.io';

    // Designated initializer
    // Must be called with valid access token before any another methods
    // @param string token : Your API token
    // @deprecated @param options object : Options
    behave.init = function(token, options) {
      behave.token = token;
      behave.options = options || {};
      behave.realtime = {
        enabled: false
      };
      behave.requestQueue = behave.queue(function(request, callback) {
        if (request.params && (request.method === 'POST' || request.method === 'PUT')) {
          request.params = JSON.stringify(request.params);
        }
        jQuery.ajax({
          url: behave.API_ROOT + (typeof(request.path) == 'function' ? request.path() : request.path),
          type: request.method || 'GET',
          data: request.params,
          headers: {
            'X-Behave-Api-Token': behave.token,
            'Content-Type': 'application/json'
          },
          xhrFields: {
            withCredentials: true
          }
        }).done(function(data, textStatus, jqXHR) {
          if (callback) callback(null, data);
        }).fail(function(jqXHR, textStatus, errorThrown) {
          if (callback) callback(errorThrown, null);
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
          if (window.Faye) {
            behave.realtime.client  = new window.Faye.Client(behave.API_ROOT + '/realtime');
            behave.realtime.client.addExtension({
              outgoing: function(message, callback) {
                message.ext = { token: behave.token };
                callback(message);
              }
            });
            behave.realtime.enabled = true;
          }
        }
      }));

      // Flush default behaviours list
      // if (behave.options.behaviours) {
      //   behave.requestQueue.push({
      //     path: '/app/behaviours'
      //   });
      // }
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

      if (!behave.assertInitialized(callback)) return;

      if (!userId) {
        console.error("Error behave.identify() userId cannot be null");
        return;
      }

      var request;
      if (behave.player.anonymous && behave.player.isIdentified()) {
        request = {
          path: '/players/' + behave.player.referenceId + '/reidentify',
          method: 'POST',
          params: { new_reference_id: userId, traits: traits  }
        };
      } else {
        request = {
          path: '/players/' + userId + '/identify',
          method: 'POST',
          params: { traits: traits }
        };
      }

      behave.player.referenceId = userId;
      behave.player.anonymous   = false;

      behave.requestQueue.push(request, behave.responseHandler(function(err, result) {
        behave.player.referenceId = result.reference_id;
        behave.player.traits      = result.traits;
        behave.player.level       = result.level;
        behave.player.points      = result.points;

        if (behave.realtime.enabled) {
          // Cancel existing subscription if necessary
          if (behave.realtime.channelSubscription) {
            behave.realtime.channelSubscription.cancel();
          }
          
          // Format: ":app_id/:player_reference_id/rewards"
          var channel = '/' + result.app_id + '/' + behave.player.referenceId + '/rewards';

          // Register and delegate handling to behave.handleTrackingResponse()
          behave.realtime.channelSubscription = behave.realtime.client.subscribe(channel, function(rewards) {
            behave.handleTrackingResponse(null, rewards);
          });

          // Handle subscription error cases (unauthorized etc...)
          behave.realtime.channelSubscription.errback(function(err) {
            console.error(err.message);
          });
        }

        behave.events.publish('player:identified', behave.player);

        if (callback) { callback(err, result); }
      }));
    };

    // Track a player's behaviour
    // @param behaviour string : The behaviour (e.g "Did purchase pack" or "did-purchase-pack" to avoid mistyping)
    // @param context object (optional) : THe context in which this action was taken. Use this parameter to provide ANY
    // custom data you may use in your recipes as filters. It is good practice to always describe to context when possible.
    behave.track = function(behaviour, context, callback) {
      callback = (typeof context === 'function' ? context : callback);
      context  = (typeof context === 'object'   ? context : null);

      behave.requestQueue.push({
        path: function() {
         if (behave.player.isIdentified()) {
            return '/players/' + behave.player.referenceId + '/track';
         } else {
            return '/players/anonymous_track';
         }
        },
        method: 'POST',
        params: {
          verb: behaviour,
          context: context
        }
      }, behave.responseHandler(function(err, result) {
          // If player was anonymous, assign auto-generated reference_id
          if (!err && result && result.is_anonymous && behave.player.anonymous) {
            behave.player.referenceId = result.player;
          }
          
          // Let websockets handle rewards if realtime is enabled.
          // Handle it now otherwise.
          if (!behave.realtime.enabled) {
            behave.handleTrackingResponse(err, result); 
          }

          if (callback) { callback(err, result); }
      }));
    };

    // Fetch the given player
    // @param playerId string : The player's reference id
    // @param callback function : The callback
    behave.fetchPlayer = function(playerId, callback) {
      behave.requestQueue.push({
        path: '/players/' + playerId
      }, behave.responseHandler(callback));
    };

    // Fetch the given player badges (unlocked)
    // @param playerId string : The player's reference id
    // @param callback function : The callback
    behave.fetchPlayerBadges = function(playerId, callback) {
      behave.requestQueue.push({
        path: '/players/' + playerId + '/badges'
      }, behave.responseHandler(callback));
    };

    // Fetch the given player locked badges (not owned)
    // @param playerId string : The player's reference id
    // @param callback function : The callback
    behave.fetchPlayerLockedBadges = function(playerId, callback) {
      behave.requestQueue.push({
        path: '/players/' + playerId + '/badges/todo'
      }, behave.responseHandler(callback));
    };

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
      
      if (!behave.assertInitialized(callback)) return;

      options.limit = options.limit ? Math.min(1000, options.limit) : 1000
      options.offset = options.page ? (options.page - 1) * options.limit : 0;

      // Lower limit if "max position" option given and is lower than the limit   
      if (options.max && options.max < options.limit) {
        options.limit = options.max;
      }

      behave.requestQueue.push({
        path: '/leaderboards/' + leaderboardId + '/results',
        method: 'POST',
        params: options
      }, behave.responseHandler(callback));
    };

    behave.iterateLeaderboardResults = function(leaderboardId, options, iterator, callback) {
      callback = (typeof options === 'function' ? iterator : callback);
      iterator = (typeof options === 'function' ? options  : iterator);
      options  = (typeof options === 'object'   ? options  : {});

      if (!behave.assertInitialized(callback)) return;

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
        } else {
          callback(err);
        }
      });
    }

    // Fetch ALL the leaderboard results FOR the given player
    // It will return all the leaderboards the player is currently in.
    // @param playerId string : The player reference id
    // @param options object (optional) : fetch options
    //    - leaderboards (Array) : reference_id(s) of leaderboard to fetch result from (all by default)
    //    - max (Number) : if specified (>0) the leaderboards when the player's position is > max will be
    //      ignored.
    // @param callback function : callback
    behave.fetchPlayerLeaderboardResults = function(playerId, options, callback) {
      var self = this;
      callback = (typeof options === 'function' ? options : callback);
      options  = (typeof options === 'object'   ? options : {});

      options.player_id = playerId;

      behave.requestQueue.push({
        path: '/leaderboards/player-results',
        method: 'POST',
        params: options
      }, behave.responseHandler(callback));
    };

    // Fetch a specific leaderboard result for the given player
    // @param playerId string : The player reference id
    // @param leaderboardId string : The leaderboard's reference id
    // @param options object (optional) : fetch options
    // @param callback function : callback
    behave.fetchPlayerLeaderboardResult = function(playerId, leaderboardId, options, callback) {
      var self = this;
      callback = (typeof options === 'function' ? options : callback);
      options  = (typeof options === 'object'   ? options : {});
     
      options.leaderboards = [leaderboardId];

      behave.fetchPlayerLeaderboardResults(playerId, options, function(err, results) {
        if (callback) { callback(err, results ? results[0] : null); }
      });
    };

    behave.assertInitialized = function(callback) {
      if (!behave.token) {
        if (callback) {
          callback("behave.init(token, options) must be called with a valid token before calling any other methods");
        } else {
          console.error("behave.init(token, options) must be called with a valid token before calling any other methods");
        }
        return false;
      } else {
        return true;
      }
    }

    behave.assertPlayerIsIdentified = function(callback) {
      if (behave.assertInitialized(callback) && !behave.player.isIdentified()) {
        if (callback) {
          callback("behave.identify() must be called before tracking any of the player's behaviours.");
        } else {
          console.error("behave.identify() must be called before tracking any of the player's behaviours.");
        }
        return false;
      } else {
        return true;
      }
    }

    behave.responseHandler = function(callback) {
      return function(err, result) {
        if (callback) {
          if (err || result.error) { return callback(err || result.error); }
          callback(null, result.data);        
        }
      };
    };

    behave.handleTrackingResponse = function(err, results) {
      if (!err && results) {

        // We need to update everything in the player BEFORE we start triggering event
        // this avoid triggering events when the player object is not updated yet
        // and can lead to inconsistency issues
        if (results.points) {
          behave.player.points = results.points.balance;
        }

        if (results.level) {
          behave.player.level = results.level;
        }

        // THEN we trigger necessary events
        if (results.badges.length) {
          results.badges.forEach(function(badge) {
            behave.events.publish('reward:badge', badge);            
          });
        }

        if (results.points && results.points.earned != 0) {
          behave.events.publish('reward:points', results.points);
        }

        if (results.level && results.level.up) {
          behave.events.publish('reward:level', results.level);
        }
      }
    }

    behave.displayBadgeIfNeeded = function(err, result) {
      if (!err && result && result.badges && result.badges.length) {
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
                 + "  <div class=\"bh-dialog-backdrop fade\"></div>"
                 + "  <div style=\"text-align:center\" class=\"bh-well bh-dialog\">"
                 + "    <div class=\"bh-legend\" style=\"text-align:center\">" + options.badge.name + "</div>"
                 + "    <div>"
                 + "      <img style=\"margin:auto;display:block\" "
                 + "           src=\""+ options.badge.icon + "\" "
                 + "           width=\"140px\" "
                 + "           height=\"140px\" />"
                 + "    </div>"
                 + "    <br>"
                 + "    <p>"
                 + "      " + options.badge.message
                 + "    </p>"
                 + "    <hr>"
                 + (this.facebookEnabled ? "<div class=\"bh-btn bh-btn-facebook\" ng-click=\"shareOnFacebook()\"><i class=\"icon-facebook\"></i> | Share</div>" : "")
                 + "    <div class=\"bh-btn\" ng-click=\"close()\">" + (this.facebookEnabled ? 'Or close' : 'close') + "</div>"
                 + "  </div>"
                 + "</div>";
          },

          open: function() {
            var self = this;

            // Compile and add element to the DOM
            self.el = jQuery(self.compile()).appendTo('body');

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
                description: options.badge.hint
              }, function(response) {
                // Badge was published
                if (response && response.post_id) {
                  if (self.isOpen()) {
                    self.close();
                  }
                  window.behave.track('shared badge', {
                    on: 'facebook',
                    fb_post_id: response.post_id,
                    badge: options.badge.reference_id  
                  });
                }
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
