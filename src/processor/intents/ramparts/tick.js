var _ = require('lodash'),
    utils = require('../../../utils'),
    driver = utils.getDriver(),
    C = driver.constants;

module.exports = function(object, {roomObjects, bulk, roomController, gameTime}) {

    if(!object || object.type != 'rampart') return;

    var effect = _.find(object.effects, {power: C.PWR_SHIELD});
    if(effect) {
        if(effect.endTime <= gameTime) {
            bulk.remove(object._id);
            delete roomObjects[object._id];
        }
        return;
    }

    if(roomController && object.user != '2') {
        var hitsMax = object.user == roomController.user ? C.RAMPART_HITS_MAX[roomController.level] || 0 : 0;
        if(hitsMax != object.hitsMax) {
            bulk.update(object, {hitsMax});
        }
    }

    if(!object.nextDecayTime || gameTime >= object.nextDecayTime-1) {
        object.hits = object.hits || 0;
        object.hits -= C.RAMPART_DECAY_AMOUNT;
        if(object.hits <= 0) {
            bulk.remove(object._id);
            delete roomObjects[object._id];
        }
        else {
            object.nextDecayTime = gameTime + C.RAMPART_DECAY_TIME;
            bulk.update(object, {
                hits: object.hits,
                nextDecayTime: object.nextDecayTime
            });
        }
    }


};
