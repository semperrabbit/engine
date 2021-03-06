var _ = require('lodash'),
    utils =  require('../../../utils'),
    driver = utils.getDriver(),
    C = driver.constants;

module.exports = function(spawn, intent, {bulk}) {
    if(spawn.type != 'spawn' || !spawn.spawning)
        return;
    var directions = intent.directions;
    if(_.isArray(directions) && directions.length > 0) {
        // convert directions to numbers, eliminate duplicates
        directions = _.uniq(_.map(directions, e => +e));
        // bail if any numbers are out of bounds or non-integers
        if(!_.any(directions, (direction)=>direction < 1 || direction > 8 || direction !== (direction | 0))) {
            const spawning = _.clone(spawn.spawning);
            spawning.directions = directions;
            bulk.update(spawn, {spawning: null});
            bulk.update(spawn, {spawning});
        }
    }
};