var utils = require('./../utils'),
    rooms = require('./rooms'),
    driver = utils.getRuntimeDriver(),
    _ = require('lodash'),
    C = driver.constants;

var runtimeData, intents, register, globals, controllersClaimedInTick;

function _getActiveBodyparts(body, type) {
    var count = 0;
    for(var i = body.length-1; i>=0; i--) {
        if (body[i].hits <= 0)
            break;
        if (body[i].type === type)
            count++;
    }
    return count;
}

function _hasActiveBodypart(body, type) {
    if(!body) {
        return true;
    }
    for(var i = body.length-1; i>=0; i--) {
        if (body[i].hits <= 0)
            break;
        if (body[i].type === type)
            return true;
    }
    return false;
}

exports.make = function(_runtimeData, _intents, _register, _globals) {

    runtimeData = _runtimeData;
    intents = _intents;
    register = _register;
    globals = _globals;

    controllersClaimedInTick = 0;

    if(globals.Creep) {
        return;
    }

    var data = (id) => {
        if(!id) {
            throw new Error("This creep doesn't exist yet");
        }
        if(!runtimeData.roomObjects[id]) {
            throw new Error("Could not find an object with ID "+id);
        }
        return runtimeData.roomObjects[id];
    };

    var Creep = register.wrapFn(function(id) {
        if(id) {
            var _data = data(id);
            globals.BaseCreep.call(this, id, "Creep");
        }
    });

    Creep.prototype = Object.create(globals.BaseCreep.prototype);
    Creep.prototype.constructor = Creep;

    utils.defineGameObjectProperties(Creep.prototype, data, {
        body: (o) => o.body,
        spawning: (o) => o.spawning,
        fatigue: (o) => o.fatigue,
    });

    Object.defineProperty(Creep.prototype, 'memory', {
        get: function() {
            if(this.id && !this.my) {
                return undefined;
            }
            if(_.isUndefined(globals.Memory.creeps) || globals.Memory.creeps === 'undefined') {
                globals.Memory.creeps = {};
            }
            if(!_.isObject(globals.Memory.creeps)) {
                return undefined;
            }
            return globals.Memory.creeps[this.name] = globals.Memory.creeps[this.name] || {};
        },
        set: function(value) {
            if(this.id && !this.my) {
                throw new Error('Could not set other player\'s creep memory');
            }
            if(_.isUndefined(globals.Memory.creeps) || globals.Memory.creeps === 'undefined') {
                globals.Memory.creeps = {};
            }
            if(!_.isObject(globals.Memory.creeps)) {
                throw new Error('Could not set creep memory');
            }
            globals.Memory.creeps[this.name] = value;
        }
    });

    Creep.prototype.toString = register.wrapFn(function() {
        return `[creep ${this.name}]`;
    });

    Creep.prototype.harvest = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.WORK)) {
            return C.ERR_NO_BODYPART;
        }
        if(!target || !target.id) {
            return C.ERR_INVALID_TARGET;
        }

        if(register.sources[target.id] && (target instanceof globals.Source)) {

            if(!target.energy) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(!target.pos.isNearTo(this.pos)) {
                return C.ERR_NOT_IN_RANGE;
            }
            if(this.room.controller && (
            this.room.controller.owner && this.room.controller.owner.username != runtimeData.user.username ||
            this.room.controller.reservation && this.room.controller.reservation.username != runtimeData.user.username)) {
                return C.ERR_NOT_OWNER;
            }

        }
        else if(register.minerals[target.id] && (target instanceof globals.Mineral)) {

            if(!target.mineralAmount) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(!target.pos.isNearTo(this.pos)) {
                return C.ERR_NOT_IN_RANGE;
            }
            var extractor = _.find(target.pos.lookFor('structure'), {structureType: C.STRUCTURE_EXTRACTOR});
            if(!extractor) {
                return C.ERR_NOT_FOUND;
            }
            if(extractor.owner && !extractor.my) {
                return C.ERR_NOT_OWNER;
            }
            if(!extractor.isActive()) {
                return C.ERR_RCL_NOT_ENOUGH;
            }
            if(extractor.cooldown) {
                return C.ERR_TIRED;
            }
        }
        else {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }

        intents.set(this.id, 'harvest', {id: target.id});
        return C.OK;
    });

    Creep.prototype.getActiveBodyparts = register.wrapFn(function(type) {
        return _getActiveBodyparts(this.body, type);
    });

    Creep.prototype.attack = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.ATTACK)) {
            return C.ERR_NO_BODYPART;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NO_BODYPART;
        }
        if(!target || !target.id || !register.creeps[target.id] && !register.powerCreeps[target.id] && !register.structures[target.id] ||
            !(target instanceof globals.Creep) && !(target instanceof globals.PowerCreep) && !(target instanceof globals.StructureSpawn) && !(target instanceof globals.Structure)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }

        var effect = _.find(target.effects, {power: C.PWR_FORTIFY});
        if(effect && effect.ticksRemaining > 0) {
            return C.ERR_INVALID_TARGET;
        }

        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }


        intents.set(this.id, 'attack', {id: target.id, x: target.pos.x, y: target.pos.y});
        return C.OK;
    });

    Creep.prototype.rangedAttack = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.RANGED_ATTACK)) {
            return C.ERR_NO_BODYPART;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NO_BODYPART;
        }
        if(!target || !target.id || !register.creeps[target.id] && !register.powerCreeps[target.id] && !register.structures[target.id] ||
            !(target instanceof globals.Creep) && !(target instanceof globals.PowerCreep) && !(target instanceof globals.StructureSpawn) && !(target instanceof globals.Structure)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!this.pos.inRangeTo(target, 3)) {
            return C.ERR_NOT_IN_RANGE;
        }

        var effect = _.find(target.effects, {power: C.PWR_FORTIFY});
        if(effect && effect.ticksRemaining > 0) {
            return C.ERR_INVALID_TARGET;
        }

        intents.set(this.id, 'rangedAttack', {id: target.id});
        return C.OK;
    });

    Creep.prototype.rangedMassAttack = register.wrapFn(function() {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.RANGED_ATTACK)) {
            return C.ERR_NO_BODYPART;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NO_BODYPART;
        }


        intents.set(this.id, 'rangedMassAttack', {});
        return C.OK;
    });

    Creep.prototype.heal = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.HEAL)) {
            return C.ERR_NO_BODYPART;
        }
        if(!target || !target.id || !register.creeps[target.id] && !register.powerCreeps[target.id] ||
            !(target instanceof globals.Creep) && !(target instanceof globals.PowerCreep)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NO_BODYPART;
        }


        intents.set(this.id, 'heal', {id: target.id, x: target.pos.x, y: target.pos.y});
        return C.OK;
    });

    Creep.prototype.rangedHeal = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.HEAL)) {
            return C.ERR_NO_BODYPART;
        }
        if(!target || !target.id || !register.creeps[target.id] && !register.powerCreeps[target.id] ||
            !(target instanceof globals.Creep) && !(target instanceof globals.PowerCreep)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NO_BODYPART;
        }
        if(!this.pos.inRangeTo(target, 3)) {
            return C.ERR_NOT_IN_RANGE;
        }


        intents.set(this.id, 'rangedHeal', {id: target.id});
        return C.OK;
    });

    Creep.prototype.repair = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.WORK)) {
            return C.ERR_NO_BODYPART;
        }
        if(!this.carry.energy) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(!target || !target.id || !register.structures[target.id] ||
            !(target instanceof globals.Structure) && !(target instanceof globals.StructureSpawn)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!this.pos.inRangeTo(target, 3)) {
            return C.ERR_NOT_IN_RANGE;
        }


        intents.set(this.id, 'repair', {id: target.id, x: target.pos.x, y: target.pos.y});
        return C.OK;
    });

    Creep.prototype.build = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.WORK)) {
            return C.ERR_NO_BODYPART;
        }
        if(!this.carry.energy) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(!target || !target.id || !register.constructionSites[target.id] || !(target instanceof globals.ConstructionSite)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!this.pos.inRangeTo(target, 3)) {
            return C.ERR_NOT_IN_RANGE;
        }

        const objects = register.objectsByRoom[data(this.id).room];
        const objectsInTile = [], creepsInTile = [], myCreepsInTile = [];
        const userId = data(this.id).user;
        _.forEach(objects, function(obj){
            if(obj.x == target.pos.x && obj.y == target.pos.y && _.contains(C.OBSTACLE_OBJECT_TYPES, obj.type)) {
                if(obj.type == 'creep') {
                    creepsInTile.push(obj);
                    if(obj.user == userId) {
                        myCreepsInTile.push(obj);
                    }
                } else {
                    objectsInTile.push(obj);
                }
            }
        });
        if(_.contains(C.OBSTACLE_OBJECT_TYPES, target.structureType)) {
            if(_.any(objectsInTile)) {
                return C.ERR_INVALID_TARGET;
            }
            const blockingCreeps = (this.room.controller && this.room.controller.my && this.room.controller.safeMode) ? myCreepsInTile : creepsInTile;
            if(_.any(blockingCreeps)) {
                return C.ERR_INVALID_TARGET;
            }
        }

        intents.set(this.id, 'build', {id: target.id, x: target.pos.x, y: target.pos.y});
        return C.OK;
    });

    Creep.prototype.suicide = register.wrapFn(function() {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }

        intents.set(this.id, 'suicide', {});
        return C.OK;
    });

    Creep.prototype.claimController = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }

        var controllersClaimed = runtimeData.user.rooms.length + controllersClaimedInTick;
        if (controllersClaimed &&
            (!runtimeData.user.gcl || runtimeData.user.gcl < utils.calcNeededGcl(controllersClaimed + 1))) {
            return C.ERR_GCL_NOT_ENOUGH;
        }
        if (controllersClaimed >= C.GCL_NOVICE && runtimeData.rooms[this.room.name].novice > Date.now()) {
            return C.ERR_FULL;
        }
        if(!target || !target.id || !register.structures[target.id] || !(target instanceof globals.Structure)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!_hasActiveBodypart(this.body, C.CLAIM)) {
            return C.ERR_NO_BODYPART;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(target.structureType != 'controller') {
            return C.ERR_INVALID_TARGET;
        }
        if(target.level > 0) {
            return C.ERR_INVALID_TARGET;
        }
        if(target.reservation && target.reservation.username != runtimeData.user.username) {
            return C.ERR_INVALID_TARGET;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NO_BODYPART;
        }

        controllersClaimedInTick++;

        intents.set(this.id, 'claimController', {id: target.id});
        return C.OK;
    });

    Creep.prototype.attackController = register.wrapFn(function(target) {
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!target || !target.id || !register.structures[target.id] || !(target instanceof globals.StructureController)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!_getActiveBodyparts(this.body, C.CLAIM)) {
            return C.ERR_NO_BODYPART;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(!target.owner && !target.reservation) {
            return C.ERR_INVALID_TARGET;
        }
        if(data(target.id).upgradeBlocked > runtimeData.time) {
            return C.ERR_TIRED;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NO_BODYPART;
        }

        intents.set(this.id, 'attackController', {id: target.id});
        return C.OK;
    });

    Creep.prototype.upgradeController = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.WORK)) {
            return C.ERR_NO_BODYPART;
        }
        if(!this.carry.energy) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(!target || !target.id || !register.structures[target.id] || !(target instanceof globals.StructureController)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(target.upgradeBlocked && target.upgradeBlocked > 0) {
            return C.ERR_INVALID_TARGET;
        }
        if(!target.pos.inRangeTo(this.pos, 3)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(!target.my) {
            return C.ERR_NOT_OWNER;
        }
        if(!target.level || !target.owner) {
            return C.ERR_INVALID_TARGET;
        }


        intents.set(this.id, 'upgradeController', {id: target.id});
        return C.OK;
    });

    Creep.prototype.reserveController = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!target || !target.id || !register.structures[target.id] || !(target instanceof globals.Structure)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(target.structureType != 'controller') {
            return C.ERR_INVALID_TARGET;
        }
        if(target.owner) {
            return C.ERR_INVALID_TARGET;
        }
        if(target.reservation && target.reservation.username != runtimeData.user.username) {
            return C.ERR_INVALID_TARGET;
        }
        if(!_hasActiveBodypart(this.body, C.CLAIM)) {
            return C.ERR_NO_BODYPART;
        }


        intents.set(this.id, 'reserveController', {id: target.id});
        return C.OK;
    });

    Creep.prototype.dismantle = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_hasActiveBodypart(this.body, C.WORK)) {
            return C.ERR_NO_BODYPART;
        }
        if(!target || !target.id || !register.structures[target.id] ||
        !(target instanceof globals.Structure) && !(target instanceof globals.StructureSpawn) ||
        (target instanceof globals.StructurePowerBank)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NO_BODYPART;
        }

        var effect = _.find(target.effects, {power: C.PWR_FORTIFY});
        if(effect && effect.ticksRemaining > 0) {
            return C.ERR_INVALID_TARGET;
        }

        intents.set(this.id, 'dismantle', {id: target.id});
        return C.OK;
    });

    Creep.prototype.generateSafeMode = register.wrapFn(function(target) {

        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!(data(this.id)[C.RESOURCE_GHODIUM] >= C.SAFE_MODE_COST)) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(!target || !target.id || !register.structures[target.id] || !(target instanceof globals.StructureController)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }

        intents.set(this.id, 'generateSafeMode', {id: target.id});
        return C.OK;
    });

    Creep.prototype.signController = register.wrapFn(function(target, sign) {

        if(this.spawning) {
            return C.ERR_BUSY;
        }

        if(!target || !target.id || !register.structures[target.id] || !(target instanceof globals.Structure)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(target.structureType != 'controller') {
            return C.ERR_INVALID_TARGET;
        }

        intents.set(this.id, 'signController', {id: target.id, sign: ""+sign});
        return C.OK;
    });

    Creep.prototype.pull = register.wrapFn(function(target){
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }

        if(this.spawning) {
            return C.ERR_BUSY;
        }

        if(!target || !target.id || !register.creeps[target.id] || !(target instanceof globals.Creep) || target.spawning || target.id == this.id) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }

        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }

        intents.set(this.id, 'pull', {id: target.id});
        return C.OK;
    });

    Object.defineProperty(globals, 'Creep', {enumerable: true, value: Creep});
};

