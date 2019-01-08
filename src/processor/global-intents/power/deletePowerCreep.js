var q = require('q'),
    _ = require('lodash'),
    utils = require('../../../utils'),
    driver = utils.getDriver(),
    C = driver.constants;

module.exports = function(intent, user, {userPowerCreeps, gameTime, bulkObjects, bulkUsersPowerCreeps}) {

    var powerCreep = _.find(userPowerCreeps, i => i.user == user._id && i._id == intent.id);
    if (!powerCreep || powerCreep.spawnCooldownTime === null || powerCreep.spawnCooldownTime > gameTime) {
        return;
    }

    bulkObjects.remove(powerCreep._id);
    bulkUsersPowerCreeps.remove(powerCreep._id);
};