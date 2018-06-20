var debug = require('debug')('dialogflow-middleware');
var dialogflow = require('dialogflow');
var makeArrayOfRegex = require('./util').makeArrayOfRegex;
var generateSessionId = require('./util').generateSessionId;
var structProtoToJson = require('./structjson').structProtoToJson;

module.exports = function(config) {
    if (!config || !config.projectId) {
        throw new Error('No dialogflow project ID provided.');
    }

    if (!config.minimum_confidence) {
        config.minimum_confidence = 0.5;
    }

    if (!config.sessionIdProps) {
        config.sessionIdProps = ['user', 'channel'];
    }

    var ignoreTypePatterns = makeArrayOfRegex(config.ignoreType || []);

    var app = new dialogflow.SessionsClient();

    var middleware = {};

    middleware.receive = function(bot, message, next) {
        if (!message.text || message.is_echo || message.type === 'self_message') {
            next();
            return;
        }

        for (let pattern of ignoreTypePatterns) {
            if (pattern.test(message.type)) {
                debug('skipping call to Dialogflow since type matched ', pattern);
                next();
                return;
            }
        }

        if (message.lang) {
            app.language = message.lang;
        } else {
            app.language = 'en';
        }

        var requestSessionId = generateSessionId(config, message);

        debug(
            'Sending message to dialogflow. sessionId=%s, language=%s, text=%s',
            requestSessionId,
            app.language,
            message.text
        );

        var request = {
            session: app.sessionPath(config.projectId, requestSessionId),
            queryInput: {
                text: {
                    text: message.text,
                    languageCode: app.language,
                },
            },
        };

        app.detectIntent(request).then(function(responses) {
            const result = responses[0].queryResult;
            debug('result=%O', result);
            message.intent = result.intent.displayName;
            message.entities = structProtoToJson(result.parameters);
            message.fulfillment = {
                speech: result.fulfillmentText,
                messages: result.fulfillmentMessages,
            };
            message.confidence = result.intentDetectionConfidence;
            message.nlpResponse = result;
            debug('dialogflow annotated message: %O', message);
            next();
        }).catch(function(error) {
            debug('dialogflow returned error', error);
        });
    };

    middleware.hears = function(patterns, message) {
        var regexPatterns = makeArrayOfRegex(patterns);

        for (let pattern of regexPatterns) {
            if (pattern.test(message.intent) && message.confidence >= config.minimum_confidence) {
                debug('dialogflow intent matched hear pattern', message.intent, pattern);
                return true;
            }
        }

        return false;
    };

    middleware.action = function(patterns, message) {
        var regexPatterns = makeArrayOfRegex(patterns);

        for (let pattern of regexPatterns) {
            if (pattern.test(message.nlpResponse.result.action) && message.confidence >= config.minimum_confidence) {
                debug('dialogflow action matched hear pattern', message.intent, pattern);
                return true;
            }
        }

        return false;
    };

    return middleware;
};
