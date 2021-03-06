var assert = require('assert')
var extend = require("extend")
var bignum = require("bignumber")
var ByteBuffer = require("bytebuffer")
var slots = require("../helpers/slots.js")
var helpers = require('../helpers')

var private = {}, self = null,
	library = null, modules = null

//constructor
function Transaction(cb, _library) {
	self = this
	library = _library
	cb(null, self)
}

Transaction.prototype.create = function (data, keypair, secondKeypair) {
	var trs = {
    fee: data.fee,
    senderPublicKey: keypair.publicKey.toString('hex'),
		senderId: modules.blockchain.accounts.generateAddressByPublicKey(keypair.publicKey),
    timestamp: slots.getTime(),
    type: data.type,
		args: data.args
  };
  trs.signature = modules.api.crypto.sign(keypair, this.getBytes(trs))
  trs.id = this.getId(trs)
	return trs
}

Transaction.prototype.getId = function (trs) {
	return modules.api.crypto.getId(this.getBytes(trs))
}

Transaction.prototype.getBytes = function (trs, skipSignature) {
	try {
		var bb = new ByteBuffer(1, true)
		bb.writeInt(trs.timestamp)
		bb.writeString(trs.fee)

		var senderPublicKeyBuffer = new Buffer(trs.senderPublicKey, 'hex');
		for (var i = 0; i < senderPublicKeyBuffer.length; i++) {
			bb.writeByte(senderPublicKeyBuffer[i]);
		}
		bb.writeInt(trs.type)
		if (trs.args) bb.writeString(trs.args)

		if (!skipSignature && trs.signature) {
			var signatureBuffer = new Buffer(trs.signature, 'hex');
			for (var i = 0; i < signatureBuffer.length; i++) {
				bb.writeByte(signatureBuffer[i]);
			}
		}

		bb.flip()
	} catch (e) {
		console.log(trs)
		throw Error(e.toString())
	}
	return bb.toBuffer()
}

Transaction.prototype.verifyBytes = function (publicKey, signature, bytes) {
	return modules.api.crypto.verify(publicKey, signature, bytes)
}

Transaction.prototype.verifySignature = function (trs, publicKey, signature) {
	if (!signature) return false

	try {
		var bytes = self.getBytes(trs, true)
		var res = modules.api.crypto.verify(publicKey, signature, bytes)
	} catch (e) {
		throw Error(e.toString())
	}

	return res
}

Transaction.prototype.verify = function (trs) { //inheritance
	if (trs.timestamp > slots.getNow()) {
		throw new Error("Invalid timestamp")
	}

	if (!trs.type) {
		throw new Error("Invalid function")
	}

	try {
		var valid = self.verifySignature(trs, trs.senderPublicKey, trs.signature)
	} catch (e) {
		throw new Error('verify signature exception: ' + e)
	}
	return valid
}

Transaction.prototype.apply = async function (transaction, block) {
	if (block.height !== 1) {
		let feeInfo = app.getFee(transaction.type) || app.defaultFee
		if (bignum(transaction.fee).lt(feeInfo.min)) {
			throw new Error('Invalid transaction fee')
		}
		let balance = app.balances.get(transaction.senderId, feeInfo.currency)
		if (balance.lt(transaction.fee)) {
			throw new Error('Insufficient balance')
		}
		app.balances.decrease(transaction.senderId, feeInfo.currency, transaction.fee)
	}

	let name = app.getContractName(transaction.type)
	if (!name) {
		throw new Error('Unsupported transaction type')
	}
	let [mod, func] = name.split('.')
	if (!mod || !func) {
		throw new Error('Invalid transaction function')
	}
	let fn = app.contract[mod][func]
	if (!fn) {
		throw new Error('Contract not found')
	}
	let bind = {
		trs: transaction,
		block: block
	}

	app.sdb.beginTransaction()
	let error = await fn.apply(bind, JSON.parse(transaction.args))
	if (error) {
		throw new Error(error)
	}

	app.sdb.commitTransaction()
}

Transaction.prototype.normalize = function (tx) {
	for (var i in tx) {
		if (tx[i] === null || typeof tx[i] === "undefined") {
			delete tx[i]
		}
	}

	var valid = library.validator.validate(tx, {
		type: "object",
		properties: {
			id: {
				type: "string"
			},
			timestamp: {
				type: "integer"
			},
			senderId: {
				type: "string"
			},
			senderPublicKey: {
				type: "string",
				format: "publicKey"
			},
			fee: {
				type: "string"
			},
			signature: {
				type: "string",
				format: "signature"
			},
			type: {
				type: "integer"
			},
			args: {
				type: "string"
			}
		},
		required: ["timestamp", "senderPublicKey", "fee", "signature", "type", "args"]
	})
	if (!valid) {
		throw new Error(library.validator.getLastError().details[0].message)
	}
}

Transaction.prototype.onBind = function (_modules) {
	modules = _modules
}

//export
module.exports = Transaction
