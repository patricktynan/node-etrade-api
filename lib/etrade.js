var crypto = require('crypto');
var oauth_sign = require('oauth-sign');
var querystring = require('querystring');
var request = require('request');

module.exports = exports = function(options)
{
    // Options
    // {
    //      "useSandbox" : true | false, // default is true
    //      "key" : key,
    //      "secret" : secret
    // }

    if (arguments.length != 1 || typeof options != "object")
        throw Error("The etrade module requires an options block object parameter");
    if (!options.hasOwnProperty("key"))
        throw Error("The etrade module requires specification of an API key");
    if (!options.hasOwnProperty("secret"))
        throw Error("The etrade module requires specification of an API secret");
    if (!options.hasOwnProperty("useSandbox"))
        options.useSandbox = true;

    var configurations = 
    {
            "base" : {
                "oauth" : {
                    "host" : "etws.etrade.com",
                    "token" : "",
                    "secret" : "",
                    "code" : ""
                },
                "authorize" : {
                    "host" : "us.etrade.com",
                    "path" : "/e/t/etws/authorize",
                    "login": "/home",
                },
                "pushURL" : "https://etwspushsb.etrade.com/apistream/cometd/oauth/",
                "getHostname" : function(module) {
                    return module == "oauth" ? this.oauth.host : this.host;
                },
                "production" : !options.useSandbox,
            },
            "production" : {
                "host" : "etws.etrade.com",
                "buildPath" : function(module,action) {
                    return "/" + module + "/rest/" + action + (module == "oauth" ? "" : ".json");
                }
            },
            "sandbox" : {
                "host" : "etwssandbox.etrade.com",
                "buildPath" : function(module,action) {
                    return "/" + module + (module == "oauth" ? "/" : "/sandbox/rest/") +
                    action + (module == "oauth" ? "" : ".json");
                }
            },
    };

    this.configuration = configurations.base;

    if (options.useSandbox)
    {
        for (var attrname in configurations.sandbox)
        {
            this.configuration[attrname] = configurations.sandbox[attrname];
        }
    }
    else
    {
        for (var attrname in configurations.production)
        {
            this.configuration[attrname] = configurations.production[attrname];
        }
    }

    this.configuration.key = options.key;
    this.configuration.secret = options.secret;
};

exports.prototype.requestToken = function(successCallback,errorCallback)
{
    // One of successCallback or errorCallback is invoked
    // successCallback is invoked with the redirection address
    // errorCallback is invoked with an error message indicating the failure
    if (arguments.length != 2)
        errorCallback("Invalid invocation of etrade::requestToken(): Two arguments are required");
    else if (typeof(successCallback) != "function" ||
            typeof(errorCallback) != "function")
        errorCallback("Invalid invocation of etrade::requestToken(): One or more arguments are not functions");

    //
    // From the etrade dev portal at 
    // https://us.etrade.com/ctnt/dev-portal/getDetail?contentUri=V0_Documentation-AuthorizationAPI-GetRequestToken
    //
    // oauth_consumer_key 	string 	The value used by the consumer to identify itself to the service provider.
    // oauth_timestamp 	integer 	The date and time of the request, in epoch time. Must be accurate within five minutes.
    // oauth_nonce 	string 	A nonce, as described in the authorization guide - roughly, an arbitrary or random value that cannot be used again with the same timestamp.
    // oauth_signature_method 	string 	The signature method used by the consumer to sign the request. The only supported value is "HMAC-SHA1".
    // oauth_signature 	string 	Signature generated with the shared secret and token secret using the specified oauth_signature_method, as described in OAuth documentation.
    // oauth_callback 	string 	Callback information, as described elsewhere. Must always be set to "oob", whether using a callback or not.
    //

    var method = "GET";
    var ts = new Date();
    var module = "oauth";
    var action = "request_token";

    var requestOptions = this._getRequestOptions(method,ts,module,action);

    // Add this call's query parameters
    requestOptions.qs.oauth_callback = "oob";

    // Sign the request
    var oauth_signature = oauth_sign.hmacsign(requestOptions.method,requestOptions.url,
                                              requestOptions.qs,this.configuration.secret);
    // Add the signature to the request
    requestOptions.qs.oauth_signature = oauth_signature;
    
    // Make the request
    request(requestOptions,function(error,message,body)
    {
        if (error) 
        { 
            console.log("Error received: " + error); 
            errorCallback(error); 
        }
        else 
        { 
            var response = this._parseBody(message.headers["content-type"],body);
            
            // https://us.etrade.com/e/t/etws/authorize?key={oauth_consumer_key}&token={oauth_token}
            keyToken = {
                key : this.configuration.key,
                token : response.oauth_token
            };
            var url = "https://us.etrade.com/e/t/etws/authorize?" +
                       querystring.stringify(keyToken);
            
            successCallback(url); 
        }
    }.bind(this));
};

exports.prototype._getRequestOptions = function(method, timeStamp, module, action)
{
    return {
        url : "https://" + this.configuration.getHostname(module) +
        this.configuration.buildPath(module,action),
        method : method,
        qs : {
            oauth_consumer_key : this.configuration.key,
            oauth_nonce : this._generateNonceFor(timeStamp),
            oauth_signature_method : "HMAC-SHA1",
            oauth_timestamp : Math.floor(timeStamp.getTime()/1000),
            oauth_version : "1.0" // Yes, needs to be a string (otherwise gets truncated)  
        },

    };
};

exports.prototype._generateNonceFor = function(timeStamp)
{
    var msSinceEpoch = timeStamp.getTime();

    var secondsSinceEpoch = Math.floor(msSinceEpoch / 1000.0);
    var msSinceSecond = (msSinceEpoch - (secondsSinceEpoch*1000)) / 1000.0;

    var maxRand = 2147483647.0;  // This constant comes from PHP, IIRC
    var rand = Math.round(Math.random() * maxRand);

    var microtimeString = "" + msSinceSecond + "00000 " + secondsSinceEpoch;   
    var nonce = microtimeString + rand;

    var md5Hash = crypto.createHash('md5');    
    md5Hash.update(nonce);
    return md5Hash.digest('hex');
};

exports.prototype._parseBody = function(contentType,body)
{
    var contentTypes = {
            "application/x-www-form-urlencoded" : function(body)
            {
                return querystring.parse(body);
            },
            "application/json" : function(body)
            {
                return JSON.parse(body);
            }
    };
    contentType = contentType.split(";")[0];

    if (typeof(contentTypes[contentType]) == 'function')
    {
        return contentTypes[contentType](body);
    }
    else
    {
        throw "Unrecognized content type: " + contentType;
    }
};