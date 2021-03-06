'use strict';
const Joi = require('joi'),
	validation = require('../models/validation');

module.exports = {

	updateUser: {
		body: Joi.object().keys({
			alias: validation.user.alias,
			roles: validation.user.roles,
			bans: validation.user.bans,
			profile: Joi.object().keys({
				bio: validation.profile.bio,
			}).unknown(false),
		}).unknown(false),
	},

	createUser: {
		body: Joi.object().keys({
			alias: validation.user.alias,
		}),
	},

	mergeUsers: {
		body: Joi.object().keys({
			placeholderID: validation.user.id,
			realID: validation.user.id,
		})
	},

	updateAllUserStats: {
		body: Joi.object().keys({
			cosXP: validation.userStats.cosXP,
		}).unknown(false),
	},

	getMaps: {
		query: Joi.object().keys({
			limit: validation.queryParam.limit,
			offset: validation.queryParam.offset,
			search: validation.queryParam.search,
			submitterID: validation.user.id,
			expand: validation.queryParam.expand,
			priority: validation.queryParam.priority,
			status: validation.queryParam.status,
		}),
	},

	updateMap: {
		body: Joi.object().keys({
			statusFlag: validation.map.statusFlag,
		}).unknown(false),
	},

	getReports: {
		query: Joi.object().keys({
			limit: validation.queryParam.limit,
			offset: validation.queryParam.offset,
			resolved: validation.report.resolved,
		}),
	},

	updateReport: {
		body: Joi.object().keys({
			resolved: validation.report.resolved,
			resolutionMessage: validation.report.resolutionMessage,
		}).unknown(false),
	},

	updateXPSystems: {
		body: Joi.object().keys({
			rankXP: validation.xpSystems.rankXP,
			cosXP: validation.xpSystems.cosXP,
		}).unknown(false),
	},

};
