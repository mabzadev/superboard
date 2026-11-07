import * as adapterConfig from "../configs/adapter";
import * as errorConfig from "../configs/error";
import type * as typeConfig from "../configs/primitives";
import { dbUtil, timeUtil } from "../utils";

export enum MfaType {
	Otp = "otp",
	Email = "email",
}

export enum SocialAccountType {
	Google = "Google",
	GitHub = "GitHub",
	Apple = "Apple",
}

export interface Common {
	id: number;
	authId: string;
	email: string | null;
	socialAccountId: string | null;
	socialAccountType: SocialAccountType | null;
	locale: typeConfig.Locale;
	password: string | null;
	firstName: string | null;
	lastName: string | null;
	loginCount: number;
	otpSecret: string;
	linkedAuthId: string | null;
	recoveryCodeHash: string | null;
	invitationToken: string | null;
	invitationExpiresAt: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface Raw extends Common {
	emailVerified: number;
	otpVerified: number;
	skipPasskeyEnroll: number;
	orgSlug?: string;
	smsPhoneNumber?: string | null;
	smsPhoneNumberVerified?: number;
	isActive: number;
	mfaTypes: string;
}

export interface Record extends Common {
	emailVerified: boolean;
	otpVerified: boolean;
	skipPasskeyEnroll: boolean;
	isActive: boolean;
	mfaTypes: string[];
}

export interface ApiRecord {
	id: number;
	authId: string;
	linkedAuthId: string | null;
	socialAccountId: string | null;
	socialAccountType: SocialAccountType | null;
	email: string | null;
	locale: typeConfig.Locale;
	firstName?: string | null;
	lastName?: string | null;
	emailVerified: boolean;
	otpVerified: boolean;
	loginCount: number;
	mfaTypes: string[];
	isActive: boolean;
	isInviting: boolean;
	invitationExpiresAt: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface PaginatedApiRecords {
	users: ApiRecord[];
	count: number;
}

export interface ApiRecordFull extends ApiRecord {
	roles?: string[];
	attributes?: globalThis.Record<string, string>;
}

export interface Create {
	authId: string;
	locale: typeConfig.Locale;
	email: string | null;
	socialAccountId: string | null;
	socialAccountType: SocialAccountType | null;
	password: string | null;
	otpSecret?: string;
	emailVerified?: number;
	firstName: string | null;
	lastName: string | null;
	invitationToken?: string | null;
	invitationExpiresAt?: string | null;
	isActive?: number;
}

export interface Update {
	email?: string;
	password?: string | null;
	otpSecret?: string;
	mfaTypes?: string;
	firstName?: string | null;
	lastName?: string | null;
	locale?: string;
	loginCount?: number;
	deletedAt?: string | null;
	updatedAt?: string | null;
	isActive?: number;
	emailVerified?: number;
	otpVerified?: number;
	linkedAuthId?: string | null;
	skipPasskeyEnroll?: number;
	recoveryCodeHash?: string | null;
	invitationToken?: string | null;
	invitationExpiresAt?: string | null;
}

const TableName = `"${adapterConfig.TableName.User}"`;

const mfaTypeValues: string[] = Object.values(MfaType);

export const convertToRecord = (raw: Raw): Record => {
	const {
		orgSlug: _orgSlug,
		smsPhoneNumber: _smsPhoneNumber,
		smsPhoneNumberVerified: _smsPhoneNumberVerified,
		...user
	} = raw;
	return {
		...user,
		emailVerified: !!raw.emailVerified,
		skipPasskeyEnroll: !!raw.skipPasskeyEnroll,
		otpVerified: !!raw.otpVerified,
		isActive: !!raw.isActive,
		mfaTypes: raw.mfaTypes
			? raw.mfaTypes.split(",").filter((type) => mfaTypeValues.includes(type))
			: [],
	};
};

export const convertToApiRecord = (record: Record, enableNames: boolean): ApiRecord => {
	const result: ApiRecord = {
		id: record.id,
		authId: record.authId,
		linkedAuthId: record.linkedAuthId,
		socialAccountId: record.socialAccountId,
		socialAccountType: record.socialAccountType,
		email: record.email,
		locale: record.locale,
		emailVerified: record.emailVerified,
		otpVerified: record.otpVerified,
		mfaTypes: record.mfaTypes,
		isActive: record.isActive,
		isInviting: !!record.invitationToken,
		invitationExpiresAt: timeUtil.convertDbTimeToUtcISOString(record.invitationExpiresAt),
		loginCount: record.loginCount,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		deletedAt: record.deletedAt,
	};
	if (enableNames) {
		result.firstName = record.firstName;
		result.lastName = record.lastName;
	}
	return result;
};

export const convertToApiRecordFull = (
	record: Record,
	enableNames: boolean,
	roles: string[],
	attributes: globalThis.Record<string, string> | undefined,
): ApiRecordFull => {
	const result: ApiRecordFull = convertToApiRecord(record, enableNames);

	return {
		...result,
		roles,
		attributes,
	};
};

export const getAll = async (
	db: D1Database,
	option?: {
		search?: typeConfig.Search;
		match?: typeConfig.Match;
		pagination?: typeConfig.Pagination;
		whereIn?: typeConfig.WhereIn;
	},
): Promise<Record[]> => {
	const stmt = dbUtil.d1SelectAllQuery(db, TableName, option);
	const { results: users }: { results: Raw[] } = await stmt.all();
	return users.map((user) => convertToRecord(user));
};

export const count = async (
	db: D1Database,
	option?: {
		search?: typeConfig.Search;
		match?: typeConfig.Match;
	},
): Promise<number> => {
	let num = 1;
	const matchCondition = option?.match ? `AND "${option.match.column}" = $${num++}` : "";
	const searchCondition = option?.search ? `AND ${option.search.column} LIKE $${num++}` : "";

	const bind = [];
	if (option?.match) {
		bind.push(option.match.value);
	}
	if (option?.search) {
		bind.push(option.search.value);
	}

	const query = `SELECT COUNT(*) as count FROM ${TableName} where "deletedAt" IS NULL ${matchCondition} ${searchCondition}`;
	const stmt = bind.length ? db.prepare(query).bind(...bind) : db.prepare(query);
	const result = (await stmt.first()) as { count: number };
	return Number(result.count);
};

export const getById = async (db: D1Database, id: number): Promise<Record | null> => {
	const stmt = db
		.prepare(`SELECT * FROM ${TableName} WHERE id = $1 AND "deletedAt" IS NULL`)
		.bind(id);
	const user = (await stmt.first()) as Raw | null;
	return user ? convertToRecord(user) : null;
};

export const getByAuthId = async (db: D1Database, authId: string): Promise<Record | null> => {
	const query = `SELECT * FROM ${TableName} WHERE "authId" = $1  AND "deletedAt" IS NULL`;
	const stmt = db.prepare(query).bind(authId);
	const user = (await stmt.first()) as Raw | null;
	return user ? convertToRecord(user) : null;
};

export const getNormalUserByEmail = async (
	db: D1Database,
	email: string,
): Promise<Record | null> => {
	const query = `SELECT * FROM ${TableName} WHERE email = $1 AND "socialAccountId" IS NULL AND "deletedAt" IS NULL`;
	const stmt = db.prepare(query).bind(email);
	const user = (await stmt.first()) as Raw | null;
	return user ? convertToRecord(user) : null;
};

export const getGoogleUserByGoogleId = async (
	db: D1Database,
	googleId: string,
): Promise<Record | null> => {
	const query = `SELECT * FROM ${TableName} WHERE "socialAccountId" = $1 AND "socialAccountType" = $2  AND "deletedAt" IS NULL`;
	const stmt = db.prepare(query).bind(googleId, SocialAccountType.Google);
	const user = (await stmt.first()) as Raw | null;
	return user ? convertToRecord(user) : null;
};

export const getGithubUserByGithubId = async (
	db: D1Database,
	githubId: string,
): Promise<Record | null> => {
	const query = `SELECT * FROM ${TableName} WHERE "socialAccountId" = $1 AND "socialAccountType" = $2  AND "deletedAt" IS NULL`;
	const stmt = db.prepare(query).bind(githubId, SocialAccountType.GitHub);
	const user = (await stmt.first()) as Raw | null;
	return user ? convertToRecord(user) : null;
};

export const getAppleUserByAppleId = async (
	db: D1Database,
	appleId: string,
): Promise<Record | null> => {
	const query = `SELECT * FROM ${TableName} WHERE "socialAccountId" = $1 AND "socialAccountType" = $2  AND "deletedAt" IS NULL`;
	const stmt = db.prepare(query).bind(appleId, SocialAccountType.Apple);
	const user = (await stmt.first()) as Raw | null;
	return user ? convertToRecord(user) : null;
};

export const getOidcUserById = async (
	db: D1Database,
	oidcId: string,
	provider: string,
): Promise<Record | null> => {
	const query = `SELECT * FROM ${TableName} WHERE "socialAccountId" = $1 AND "socialAccountType" = $2  AND "deletedAt" IS NULL`;
	const stmt = db.prepare(query).bind(oidcId, provider);
	const user = (await stmt.first()) as Raw | null;
	return user ? convertToRecord(user) : null;
};

export const create = async (db: D1Database, create: Create): Promise<Record> => {
	const createKeys: (keyof Create)[] = [
		"authId",
		"email",
		"password",
		"firstName",
		"lastName",
		"locale",
		"otpSecret",
		"socialAccountId",
		"socialAccountType",
		"emailVerified",
		"invitationToken",
		"invitationExpiresAt",
		"isActive",
	];
	const stmt = dbUtil.d1CreateQuery(db, TableName, createKeys, create);
	const result = await dbUtil.d1Run(stmt);
	if (!result.success) throw new errorConfig.InternalServerError();
	const id = result.meta.last_row_id;
	const record = await getById(db, id);
	if (!record) throw new errorConfig.InternalServerError();

	return record;
};

export const updateCount = async (db: D1Database, id: number) => {
	const query = `UPDATE ${TableName} set "loginCount" = "loginCount" + 1 where id = $1`;
	const stmt = db.prepare(query).bind(id);
	await dbUtil.d1Run(stmt);
};

export const update = async (db: D1Database, id: number, update: Update): Promise<Record> => {
	const updateKeys: (keyof Update)[] = [
		"password",
		"firstName",
		"lastName",
		"deletedAt",
		"updatedAt",
		"isActive",
		"emailVerified",
		"loginCount",
		"locale",
		"otpSecret",
		"mfaTypes",
		"otpVerified",
		"email",
		"linkedAuthId",
		"skipPasskeyEnroll",
		"recoveryCodeHash",
		"invitationToken",
		"invitationExpiresAt",
	];
	const stmt = dbUtil.d1UpdateQuery(db, TableName, id, updateKeys, update);

	const result = await dbUtil.d1Run(stmt);
	if (!result.success) throw new errorConfig.InternalServerError();
	const record = await getById(db, id);
	if (!record) throw new errorConfig.InternalServerError();

	return record;
};

export const remove = async (db: D1Database, id: number): Promise<true> => {
	const stmt = dbUtil.d1SoftDeleteQuery(db, TableName, id);

	await dbUtil.d1Run(stmt);
	return true;
};

export const getByInvitationToken = async (
	db: D1Database,
	invitationToken: string,
): Promise<Record | null> => {
	const query = `SELECT * FROM ${TableName} WHERE "invitationToken" = $1 AND "deletedAt" IS NULL`;
	const stmt = db.prepare(query).bind(invitationToken);
	const user = (await stmt.first()) as Raw | null;
	return user ? convertToRecord(user) : null;
};
