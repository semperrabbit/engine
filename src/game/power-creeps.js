var utils = require('./../utils'),
    rooms = require('./rooms'),
    driver = utils.getRuntimeDriver(),
    _ = require('lodash'),
    C = driver.constants;

var runtimeData, intents, register, globals;

function calcFreePowerLevels() {
    var level = Math.floor(Math.pow((runtimeData.user.power || 0) / C.POWER_LEVEL_MULTIPLY, 1 / C.POWER_LEVEL_POW));
    var used = Object.keys(runtimeData.userPowerCreeps).length + _.sum(runtimeData.userPowerCreeps, 'level');
    return level - used;
}

function data(id) {
    return Object.assign({}, runtimeData.userPowerCreeps[id], runtimeData.roomObjects[id]);
}

exports.make = function(_runtimeData, _intents, _register, _globals) {

    runtimeData = _runtimeData;
    intents = _intents;
    register = _register;
    globals = _globals;

    if(globals.PowerCreep) {
        return;
    }

    var PowerCreep = register.wrapFn(function(id) {
        var _data = data(id);
        globals.BaseCreep.call(this, id, "PowerCreep");
        this.id = id;
    });

    PowerCreep.prototype = Object.create(globals.BaseCreep.prototype);
    PowerCreep.prototype.constructor = PowerCreep;

    utils.defineGameObjectProperties(PowerCreep.prototype, data, {
        level: (o) => o.level,
        className: (o) => o.className,
        shard: (o) => o.shard || undefined,
        spawnCooldownTime: (o) => o.spawnCooldownTime !== null && o.spawnCooldownTime > Date.now() ? o.spawnCooldownTime : undefined,
        deleteTime: (o) => o.deleteTime || undefined,
        powers: (o) => _.mapValues(o.powers, i => ({
            level: i.level,
            cooldown: Math.max(0, (i.cooldownTime || 0) - runtimeData.time)
        })),
    });

    Object.defineProperty(PowerCreep.prototype, 'memory', {
        get: function() {
            if(this.id && !this.my) {
                return undefined;
            }
            if(_.isUndefined(globals.Memory.powerCreeps) || globals.Memory.powerCreeps === 'undefined') {
                globals.Memory.powerCreeps = {};
            }
            if(!_.isObject(globals.Memory.powerCreeps)) {
                return undefined;
            }
            return globals.Memory.powerCreeps[this.name] = globals.Memory.powerCreeps[this.name] || {};
        },
        set: function(value) {
            if(this.id && !this.my) {
                throw new Error('Could not set other player\'s creep memory');
            }
            if(_.isUndefined(globals.Memory.powerCreeps) || globals.Memory.powerCreeps === 'undefined') {
                globals.Memory.powerCreeps = {};
            }
            if(!_.isObject(globals.Memory.powerCreeps)) {
                throw new Error('Could not set creep memory');
            }
            globals.Memory.powerCreeps[this.name] = value;
        }
    });

    PowerCreep.prototype.toString = register.wrapFn(function() {
        return `[powerCreep ${this.name}]`;
    });

    PowerCreep.prototype.spawn = register.wrapFn(function(powerSpawn) {
        if(this.room) {
            return C.ERR_BUSY;
        }
        if(!(powerSpawn instanceof globals.StructurePowerSpawn)) {
            return C.ERR_INVALID_TARGET;
        }
        if(!this.my || !powerSpawn.my) {
            return C.ERR_NOT_OWNER;
        }
        if(!utils.checkStructureAgainstController(data(powerSpawn.id), register.objectsByRoom[data(powerSpawn.id).room], data(powerSpawn.room.controller.id))) {
            return C.ERR_RCL_NOT_ENOUGH;
        }

        if(this.spawnCooldownTime) {
            return C.ERR_TIRED;
        }

        if(_.isUndefined(globals.Memory.powerCreeps)) {
            globals.Memory.powerCreeps = {};
        }
        if(_.isObject(globals.Memory.powerCreeps) && _.isUndefined(globals.Memory.powerCreeps[this.name])) {
            globals.Memory.powerCreeps[this.name] = {};
        }

        intents.pushByName('global', 'spawnPowerCreep', {id: powerSpawn.id, name: this.name}, 50);
        return C.OK;
    });

    PowerCreep.prototype.suicide = register.wrapFn(function() {

        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }

        intents.pushByName('global', 'suicidePowerCreep', {id: this.id}, 50);
        return C.OK;
    });

    PowerCreep.prototype.delete = register.wrapFn(function(cancel) {

        if(this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }

        intents.pushByName('global', 'deletePowerCreep', {id: this.id, cancel}, 50);
        return C.OK;
    });

    PowerCreep.prototype.upgrade = register.wrapFn(function(power) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(calcFreePowerLevels() <= 0) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(this.level >= C.POWER_CREEP_MAX_LEVEL) {
            return C.ERR_FULL;
        }
        var powerInfo = C.POWER_INFO[power];
        if(!powerInfo || powerInfo.className !== this.className) {
            return C.ERR_INVALID_ARGS;
        }
        var powerData = data(this.id).powers[power];
        var powerLevel = powerData ? powerData.level : 0;
        if(powerLevel == 5) {
            return C.ERR_FULL;
        }

        if(this.level < powerInfo.level[powerLevel]) {
            return C.ERR_FULL;
        }

        intents.pushByName('global', 'upgradePowerCreep', {id: this.id, power}, 50);
        return C.OK;
    });

    PowerCreep.prototype.usePower = register.wrapFn(function(power, target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(this.room.controller) {
            if (!this.room.controller.isPowerEnabled) {
                return C.ERR_INVALID_ARGS;
            }
            if (!this.room.controller.my && this.room.controller.safeMode) {
                return C.ERR_INVALID_ARGS;
            }
        }

        var powerData = data(this.id).powers[power];
        var powerInfo = C.POWER_INFO[power];
        if(!powerData || !powerData.level || !powerInfo) {
            return C.ERR_NO_BODYPART;
        }
        if(powerData.cooldownTime > runtimeData.time) {
            return C.ERR_TIRED;
        }
        var ops = powerInfo.ops || 0;
        if(_.isArray(ops)) {
            ops = ops[powerData.level-1];
        }
        if((data(this.id).ops || 0) < ops) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(powerInfo.range) {
            if(!target) {
                return C.ERR_INVALID_TARGET;
            }
            if(!this.pos.inRangeTo(target, powerInfo.range)) {
                return C.ERR_NOT_IN_RANGE;
            }
            var currentEffect = _.find(target.effects, i => i.power == power);
            if(currentEffect && currentEffect.level > powerData.level && currentEffect.ticksRemaining > 0) {
                return C.ERR_FULL;
            }
        }

        intents.set(this.id, 'usePower', {power, id: target ? target.id : undefined});
        return C.OK;
    });

    PowerCreep.prototype.enableRoom = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(!this.room) {
            return C.ERR_BUSY;
        }

        if(!target || !target.id || !register.structures[target.id] || !(target instanceof globals.Structure)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(target.structureType != 'controller' || target.safeMode && !target.my) {
            return C.ERR_INVALID_TARGET;
        }

        intents.set(this.id, 'enableRoom', {id: target.id});
        return C.OK;
    });

    PowerCreep.prototype.renew = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(!this.room) {
            return C.ERR_BUSY;
        }

        if(!target || !target.id || !register.structures[target.id] || !(target instanceof globals.StructurePowerBank) && !(target instanceof globals.StructurePowerSpawn)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if((target instanceof globals.StructurePowerSpawn) && !utils.checkStructureAgainstController(data(target.id), register.objectsByRoom[data(target.id).room], data(target.room.controller.id))) {
            return C.ERR_RCL_NOT_ENOUGH;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        intents.set(this.id, 'renew', {id: target.id});
        return C.OK;
    });


    PowerCreep.prototype.rename = register.wrapFn(function(name) {

        if(this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(_.any(runtimeData.userPowerCreeps, {name})) {
            return C.ERR_NAME_EXISTS;
        }

        intents.pushByName('global', 'renamePowerCreep', {id: this.id, name}, 50);
        return C.OK;
    });

    PowerCreep.create = register.wrapFn(function(name, className) {

        if(calcFreePowerLevels() <= 0) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(_.any(runtimeData.userPowerCreeps, {name})) {
            return C.ERR_NAME_EXISTS;
        }
        if(Object.values(C.POWER_CLASS).indexOf(className) === -1) {
            return C.ERR_INVALID_ARGS;
        }
        intents.pushByName('global', 'createPowerCreep', {name, className}, 50);
        return C.OK;
    });



    Object.defineProperty(globals, 'PowerCreep', {enumerable: true, value: PowerCreep});
};

