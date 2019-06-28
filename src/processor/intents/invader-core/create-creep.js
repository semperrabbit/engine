var _ = require('lodash'),
    utils = require('../../../utils'),
    driver = utils.getDriver(),
    C = driver.constants;


module.exports = function(object, intent, scope) {
    if(!object || object.spawning || object.type != 'invaderCore') return;

    if(!object.level || !C.INVADER_CORE_CREEP_SPAWN_TIME[object.level]) return;

    const {bulk} = scope;

    intent.body = intent.body.slice(0, C.MAX_CREEP_SIZE);

    const body = [];
    for(let i = 0; i < intent.body; i++) {
        if(!_.contains(C.BODYPARTS_ALL, i)) {
            continue;
        }
        const type = intent.body[i];
        if(intent.boosts && (intent.boosts.length >= i) && C.BOOSTS[type] && C.BOOSTS[type][intent.boosts[i]]){
            body.push({
                type: i,
                hits: 100,
                boost: intent.boosts[i]
            });
        } else {
            body.push({
                type: i,
                hits: 100
            });
        }
    }

    const energyCapacity = utils.calcBodyEffectiveness(body, C.CARRY, 'capacity', C.CARRY_CAPACITY, true);

    const creep = {
        name: intent.name,
        x: object.x,
        y: object.y,
        body,
        energy: 0,
        energyCapacity,
        type: 'creep',
        room: object.room,
        user: object.user,
        hits: body.length * 100,
        hitsMax: body.length * 100,
        spawning: true,
        fatigue: 0,
        notifyWhenAttacked: false,
        ageTime: object.nextDecayTime
    };

    bulk.update(object, {
        spawning: {
            name: intent.name,
            needTime: C.INVADER_CORE_CREEP_SPAWN_TIME[object.level] * body.length,
            remainingTime: C.INVADER_CORE_CREEP_SPAWN_TIME[object.level] * body.length
        }
    });

    bulk.insert(creep);
};
