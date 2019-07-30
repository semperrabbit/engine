var utils = require('./../utils'),
    rooms = require('./rooms'),
    driver = utils.getRuntimeDriver(),
    _ = require('lodash'),
    C = driver.constants;

var runtimeData, intents, register, globals, controllersClaimedInTick;

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

    if(globals.BaseCreep) {
        return;
    }

    var data = (id) => {
        if(runtimeData.userPowerCreeps[id])
            return Object.assign({}, runtimeData.userPowerCreeps[id], runtimeData.roomObjects[id]);
        return runtimeData.roomObjects[id];
    }

    var BaseCreep = register.wrapFn(function(id, type) {
        if(id) {
            if(type !== "Creep" && type !== "PowerCreep")
                throw new Error("Bad type in BaseCreep.constructor")
            var _data = data(id);
            if(_data.room) {
                globals.RoomObject.call(this, _data.x, _data.y, _data.room, _data.effects);
            }
        }
        this.id = id;
    });

    BaseCreep.prototype = Object.create(globals.RoomObject.prototype);
    BaseCreep.prototype.constructor = BaseCreep;

    utils.defineGameObjectProperties(BaseCreep.prototype, data, {
        name: (o) => o.name,
        my: (o) => o.user == runtimeData.user._id,
        owner: (o) => new Object({username: runtimeData.users[o.user].username}),
        ticksToLive: (o) => o.ageTime ? o.ageTime - runtimeData.time : undefined,
        carryCapacity: (o) => o.energyCapacity,
        carry: (o) => {
            var result = {energy: 0};

            C.RESOURCES_ALL.forEach(resourceType => {
                if(o[resourceType]) {
                    result[resourceType] = o[resourceType];
                }
            });

            return result;
        },
        hits: (o) => o.hits,
        hitsMax: (o) => o.hitsMax,
        saying: o => {
            if(!o.actionLog || !o.actionLog.say) {
                return undefined;
            }
            if(o.user == runtimeData.user._id) {
                return o.actionLog.say.message;
            }
            return o.actionLog.say.isPublic ? o.actionLog.say.message : undefined;
        }
    });

    BaseCreep.prototype.move = register.wrapFn(function(target) {

        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }

        if(target && (target instanceof globals.Creep)) {
            if(!target.pos.isNearTo(this.pos)) {
                return C.ERR_NOT_IN_RANGE;
            }

            intents.set(this.id, 'move', {id: target.id});
            return C.OK;
        }

        if((data(this.id).fatigue || 0) > 0) {
            return C.ERR_TIRED;
        }
        if(!_hasActiveBodypart(this.body, C.MOVE)) {
            return C.ERR_NO_BODYPART;
        }
        let direction = +target;
        if(!direction || direction < 1 || direction > 8) {
            return C.ERR_INVALID_ARGS;
        }
        intents.set(this.id, 'move', {direction});
        return C.OK;
    });

    BaseCreep.prototype.moveTo = register.wrapFn(function(firstArg, secondArg, opts) {

        var visualized = false;

        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(_.isObject(firstArg)) {
            opts = _.clone(secondArg);
        }
        opts = opts || {};

        if(data(this.id).fatigue > 0 && (!opts || !opts.visualizePathStyle)) {
            return C.ERR_TIRED;
        }
        if(!_hasActiveBodypart(this.body, C.MOVE)) {
            return C.ERR_NO_BODYPART;
        }

        var [x,y,roomName] = utils.fetchXYArguments(firstArg, secondArg, globals);
        roomName = roomName || this.pos.roomName;
        if(_.isUndefined(x) || _.isUndefined(y)) {
            register.assertTargetObject(firstArg);
            return C.ERR_INVALID_TARGET;
        }

        var targetPos = new globals.RoomPosition(x,y,roomName);

        if(_.isUndefined(opts.reusePath)) {
            opts.reusePath = 5;
        }
        if(_.isUndefined(opts.serializeMemory)) {
            opts.serializeMemory = true;
        }

        if(opts.visualizePathStyle) {
            _.defaults(opts.visualizePathStyle, {fill: 'transparent', stroke: '#fff', lineStyle: 'dashed', strokeWidth: .15, opacity: .1});
        }

        if(x == this.pos.x && y == this.pos.y && roomName == this.pos.roomName) {
            return C.OK;
        }

        /*if(opts.reusePath && this.room.memory && _.isObject(this.room.memory) && this.room.memory._move) {

            var key = `${this.pos.x},${this.pos.y}:${roomName},${x},${y}`;

            if(key in this.room.memory._move) {
                if(this.room.memory._move[key].t + opts.reusePath < runtimeData.time ) {
                    delete this.room.memory._move[key];
                }
                else {
                    this.move(this.room.memory._move[key].d);
                    return C.OK;
                }
            }
        }


        if(opts.noPathFinding) {
            return C.ERR_NOT_FOUND;
        }

        var path = this.pos.findPathTo(new globals.RoomPosition(x,y,roomName), opts);

        if(opts.reusePath && this.room.memory && _.isObject(this.room.memory)) {

            this.room.memory._move = this.room.memory._move || {};

            path.forEach((i) => {
                var ix = i.x - i.dx;
                var iy = i.y - i.dy;
                var key = `${ix},${iy}:${roomName},${x},${y}`;
                this.room.memory._move[key] = {
                    t: runtimeData.time,
                    d: i.direction
                };
            });
        }*/

        if(opts.reusePath && this.memory && _.isObject(this.memory) && this.memory._move) {

            var _move = this.memory._move;

            if(runtimeData.time > _move.time + parseInt(opts.reusePath) || _move.room != this.pos.roomName) {
                delete this.memory._move;
            }
            else if(_move.dest.room == roomName && _move.dest.x == x && _move.dest.y == y) {

                var path = _.isString(_move.path) ? utils.deserializePath(_move.path) : _move.path;

                var idx = _.findIndex(path, {x: this.pos.x, y: this.pos.y});
                if(idx != -1) {
                    var oldMove = _.cloneDeep(_move);
                    path.splice(0,idx+1);
                    try {
                        _move.path = opts.serializeMemory ? utils.serializePath(path) : path;
                    }
                    catch(e) {
                        console.log('$ERR',this.pos,x,y,roomName,JSON.stringify(path),'-----',JSON.stringify(oldMove));
                        throw e;
                    }
                }
                if(path.length == 0) {
                    return this.pos.isNearTo(targetPos) ? C.OK : C.ERR_NO_PATH;
                }
                if(opts.visualizePathStyle) {
                    this.room.visual.poly(path, opts.visualizePathStyle);
                    visualized = true;
                }
                var result = this.moveByPath(path);

                if(result == C.OK) {
                    return C.OK;
                }
            }
        }

        if(opts.noPathFinding) {
            return C.ERR_NOT_FOUND;
        }

        var path = this.pos.findPathTo(targetPos, opts);

        if(opts.reusePath && this.memory && _.isObject(this.memory)) {
            this.memory._move = {
                dest: {x,y,room:roomName},
                time: runtimeData.time,
                path: opts.serializeMemory ? utils.serializePath(path) : _.clone(path),
                room: this.pos.roomName
            };
        }

        if(path.length == 0) {
            return C.ERR_NO_PATH;
        }

        if(opts.visualizePathStyle && !visualized) {
            this.room.visual.poly(path, opts.visualizePathStyle);
        }

        return this.move(path[0].direction);
    });

    BaseCreep.prototype.moveByPath = register.wrapFn(function(path) {
       if(!this.room) {
            return C.ERR_BUSY;
       }
       if(_.isArray(path) && path.length > 0 && (path[0] instanceof globals.RoomPosition)) {
            var idx = _.findIndex(path, (i) => i.isEqualTo(this.pos));
            if(idx === -1) {
                if(!path[0].isNearTo(this.pos)) {
                    return C.ERR_NOT_FOUND;
                }
            }
            idx++;
            if(idx >= path.length) {
                return C.ERR_NOT_FOUND;
            }

            return this.move(this.pos.getDirectionTo(path[idx]));
        }

        if(_.isString(path)) {
            path = utils.deserializePath(path);
        }
        if(!_.isArray(path)) {
            return C.ERR_INVALID_ARGS;
        }
        var cur = _.find(path, (i) => i.x - i.dx == this.pos.x && i.y - i.dy == this.pos.y);
        if(!cur) {
            return C.ERR_NOT_FOUND;
        }

        return this.move(cur.direction);
    });

    BaseCreep.prototype.drop = register.wrapFn(function(resourceType, amount) {
        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_.contains(C.RESOURCES_ALL, resourceType)) {
            return C.ERR_INVALID_ARGS;
        }
        if(!data(this.id)[resourceType]) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(!amount) {
            amount = data(this.id)[resourceType];
        }
        if(data(this.id)[resourceType] < amount) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }

        intents.set(this.id, 'drop', {amount, resourceType});
        return C.OK;
    });

    BaseCreep.prototype.transfer = register.wrapFn(function(target, resourceType, amount) {
        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(amount < 0) {
            return C.ERR_INVALID_ARGS;
        }
        if(!_.contains(C.RESOURCES_ALL, resourceType)) {
            return C.ERR_INVALID_ARGS;
        }
        if(!target || !target.id || (!register.spawns[target.id] && !register.powerCreeps[target.id] && !register.creeps[target.id] && !register.structures[target.id]) ||
            !(target instanceof globals.StructureSpawn) && !(target instanceof globals.Structure) && !(target instanceof globals.Creep) && !(target instanceof globals.PowerCreep) && !target.spawning) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(resourceType == C.RESOURCE_ENERGY) {

            if(register.structures[target.id] && register.structures[target.id].structureType == 'controller') {
                return this.upgradeController(target);
            }

            if (register.structures[target.id] &&
                register.structures[target.id].structureType != 'extension' &&
                register.structures[target.id].structureType != 'spawn' &&
                register.structures[target.id].structureType != 'link' &&
                register.structures[target.id].structureType != 'storage' &&
                register.structures[target.id].structureType != 'tower' &&
                register.structures[target.id].structureType != 'powerSpawn' &&
                register.structures[target.id].structureType != 'terminal' &&
                register.structures[target.id].structureType != 'container' &&
                register.structures[target.id].structureType != 'lab' &&
                register.structures[target.id].structureType != 'nuker') {
                return C.ERR_INVALID_TARGET;
            }
        }
        else if(resourceType == C.RESOURCE_POWER) {
            if (register.structures[target.id] &&
                register.structures[target.id].structureType != 'storage' &&
                register.structures[target.id].structureType != 'terminal' &&
                register.structures[target.id].structureType != 'container' &&
                register.structures[target.id].structureType != 'powerSpawn') {
                return C.ERR_INVALID_TARGET;
            }
        }
        else {
            if (register.structures[target.id] &&
                register.structures[target.id].structureType != 'storage' &&
                register.structures[target.id].structureType != 'terminal' &&
                register.structures[target.id].structureType != 'container' &&
                register.structures[target.id].structureType != 'lab' &&
                register.structures[target.id].structureType != 'nuker') {
                return C.ERR_INVALID_TARGET;
            }
        }

        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }
        if(!data(this.id)[resourceType]) {
            return C.ERR_NOT_ENOUGH_RESOURCES;
        }
        if(target.structureType == 'powerSpawn') {
            if(data(target.id)[resourceType] >= data(target.id)[resourceType+'Capacity']) {
                return C.ERR_FULL;
            }
            if(!amount) {
                amount = Math.min( data(this.id)[resourceType], data(target.id)[resourceType+'Capacity'] - data(target.id)[resourceType] );
            }
            if(data(this.id)[resourceType] < amount) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(!amount || data(target.id)[resourceType] + amount > data(target.id)[resourceType+'Capacity']) {
                return C.ERR_FULL;
            }
        }
        else if(target.structureType == 'lab') {
            if(resourceType != C.RESOURCE_ENERGY && data(target.id).mineralType && data(target.id).mineralType != resourceType) {
                return C.ERR_FULL;
            }

            var targetCapacity = resourceType == C.RESOURCE_ENERGY ? data(target.id).energyCapacity : data(target.id).mineralCapacity;
            var targetAmount = resourceType == C.RESOURCE_ENERGY ? data(target.id).energy : data(target.id).mineralAmount;

            if(targetAmount > targetCapacity) {
                return C.ERR_FULL;
            }
            if(!amount) {
                amount = Math.min( data(this.id)[resourceType], targetCapacity - targetAmount );
            }
            if(data(this.id)[resourceType] < amount) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(!amount || targetAmount + amount > targetCapacity) {
                return C.ERR_FULL;
            }
        }
        else if(target.structureType == 'nuker') {
            if(resourceType != C.RESOURCE_ENERGY && resourceType != C.RESOURCE_GHODIUM) {
                return C.ERR_FULL;
            }
            if(data(target.id)[resourceType] >= data(target.id)[resourceType+'Capacity']) {
                return C.ERR_FULL;
            }
            if(!amount) {
                amount = Math.min( data(this.id)[resourceType], data(target.id)[resourceType+'Capacity'] - data(target.id)[resourceType] );
            }
            if(data(this.id)[resourceType] < amount) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(!amount || data(target.id)[resourceType] + amount > data(target.id)[resourceType+'Capacity']) {
                return C.ERR_FULL;
            }
        }
        else {
            if(!_.isUndefined(data(target.id).energyCapacity) && utils.calcResources(data(target.id)) > data(target.id).energyCapacity) {
                return C.ERR_FULL;
            }
            if(!amount) {
                if(!_.isUndefined(data(target.id).energyCapacity)) {
                    amount = Math.min(data(this.id)[resourceType], data(target.id).energyCapacity - utils.calcResources(data(target.id)));
                }
                else {
                    amount = data(this.id)[resourceType];
                }
            }
            if(data(this.id)[resourceType] < amount) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(!_.isUndefined(data(target.id).energyCapacity) && (!amount || utils.calcResources(data(target.id)) + amount > data(target.id).energyCapacity)) {
                return C.ERR_FULL;
            }
        }

        intents.set(this.id, 'transfer', {id: target.id, amount, resourceType});
        return C.OK;
    });

    BaseCreep.prototype.withdraw = register.wrapFn(function(target, resourceType, amount) {
        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(amount < 0) {
            return C.ERR_INVALID_ARGS;
        }
        if(!_.contains(C.RESOURCES_ALL, resourceType)) {
            return C.ERR_INVALID_ARGS;
        }
        if(!target || !target.id || ((!register.structures[target.id] || !(target instanceof globals.Structure) ) && !(target instanceof globals.Tombstone))) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }

        if(target.structureType == 'terminal') {
            var effect = _.find(target.effects, {power: C.PWR_DISRUPT_TERMINAL});
            if(effect && effect.ticksRemaining > 0) {
                return C.ERR_INVALID_TARGET;
            }
        }

        if(target.my === false && _.any(target.pos.lookFor('structure'), i => i.structureType == C.STRUCTURE_RAMPART && !i.my && !i.isPublic)) {
            return C.ERR_NOT_OWNER;
        }
        if(this.room.controller && !this.room.controller.my && this.room.controller.safeMode) {
            return C.ERR_NOT_OWNER;
        }

        if(resourceType == C.RESOURCE_ENERGY) {

            if (register.structures[target.id] &&
            register.structures[target.id].structureType != 'extension' &&
            register.structures[target.id].structureType != 'spawn' &&
            register.structures[target.id].structureType != 'link' &&
            register.structures[target.id].structureType != 'storage' &&
            register.structures[target.id].structureType != 'tower' &&
            register.structures[target.id].structureType != 'powerSpawn' &&
            register.structures[target.id].structureType != 'terminal' &&
            register.structures[target.id].structureType != 'container' &&
            register.structures[target.id].structureType != 'lab') {
                return C.ERR_INVALID_TARGET;
            }
        }
        else if(resourceType == C.RESOURCE_POWER) {
            if (register.structures[target.id] &&
            register.structures[target.id].structureType != 'storage' &&
            register.structures[target.id].structureType != 'terminal' &&
            register.structures[target.id].structureType != 'container' &&
            register.structures[target.id].structureType != 'powerSpawn') {
                return C.ERR_INVALID_TARGET;
            }
        }
        else {
            if (register.structures[target.id] &&
            register.structures[target.id].structureType != 'storage' &&
            register.structures[target.id].structureType != 'terminal' &&
            register.structures[target.id].structureType != 'container' &&
            register.structures[target.id].structureType != 'lab') {
                return C.ERR_INVALID_TARGET;
            }
        }

        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }

        var totalResources = utils.calcResources(data(this.id));
        var emptySpace = data(this.id).energyCapacity - totalResources;

        if(emptySpace <= 0) {
            return C.ERR_FULL;
        }

        if(target.structureType == 'powerSpawn') {
            if(!amount) {
                amount = Math.min( data(target.id)[resourceType], emptySpace );
            }
            if(!data(target.id)[resourceType] || data(target.id)[resourceType] < amount) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(amount > emptySpace) {
                return C.ERR_FULL;
            }
        }
        else if(target.structureType == 'lab') {
            if(resourceType != C.RESOURCE_ENERGY && data(target.id).mineralType && data(target.id).mineralType != resourceType) {
                return C.ERR_INVALID_ARGS;
            }

            var targetCapacity = resourceType == C.RESOURCE_ENERGY ? data(target.id).energyCapacity : data(target.id).mineralCapacity;
            var targetAmount = resourceType == C.RESOURCE_ENERGY ? data(target.id).energy : data(target.id).mineralAmount;

            if(!amount) {
                amount = Math.min( targetAmount, emptySpace );
            }

            if(!targetAmount || targetAmount < amount) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(amount > emptySpace) {
                return C.ERR_FULL;
            }
        }
        else {
            if(!amount) {
                amount = Math.min(data(target.id)[resourceType], emptySpace);
            }
            if(!data(target.id)[resourceType] || data(target.id)[resourceType] < amount) {
                return C.ERR_NOT_ENOUGH_RESOURCES;
            }
            if(amount > emptySpace) {
                return C.ERR_FULL;
            }
        }

        intents.set(this.id, 'withdraw', {id: target.id, amount, resourceType});
        return C.OK;
    });

    BaseCreep.prototype.pickup = register.wrapFn(function(target) {
        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!target || !target.id || !register.energy[target.id] || !(target instanceof globals.Energy)) {
            register.assertTargetObject(target);
            return C.ERR_INVALID_TARGET;
        }
        if(utils.calcResources(this.carry) >= this.carryCapacity) {
            return C.ERR_FULL;
        }
        if(!target.pos.isNearTo(this.pos)) {
            return C.ERR_NOT_IN_RANGE;
        }


        intents.set(this.id, 'pickup', {id: target.id});
        return C.OK;
    });

    BaseCreep.prototype.say = register.wrapFn(function(message, isPublic) {
        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }

        intents.set(this.id, 'say', {message: ""+message, isPublic});
        return C.OK;
    });

    BaseCreep.prototype.cancelOrder = register.wrapFn(function(name) {

        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(intents.remove(this.id, name)) {
            return C.OK;
        }
        return C.ERR_NOT_FOUND;
    });

    BaseCreep.prototype.notifyWhenAttacked = register.wrapFn(function(enabled) {

        if(!this.room) {
            return C.ERR_BUSY;
        }
        if(!this.my) {
            return C.ERR_NOT_OWNER;
        }
        if(this.spawning) {
            return C.ERR_BUSY;
        }
        if(!_.isBoolean(enabled)) {
            return C.ERR_INVALID_ARGS;
        }

        if(enabled != data(this.id).notifyWhenAttacked) {

            intents.set(this.id, 'notifyWhenAttacked', {enabled});
        }

        return C.OK;
    });

    Object.defineProperty(globals, 'BaseCreep', {enumerable: true, value: BaseCreep});
};
