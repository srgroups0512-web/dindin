import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {familyCapacityFor, isFamilyProduct} from '../billing/products.js';

const {Pool} = pg;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function intervalName(days) {
  return days === 2 ? 'two-days' : days === 7 ? 'weekly' : 'daily';
}

function intervalDays(value) {
  return value === 'two-days' ? 2 : value === 'weekly' ? 7 : 1;
}

function rowToCheckIn(row) {
  return {
    id: row.schedule_id,
    runId: row.run_id || undefined,
    ownerUserId: row.owner_user_id,
    relative: {
      id: row.relative_id,
      name: row.display_name,
      relationship: row.relationship,
      phone: row.phone_e164,
      interval: intervalName(Number(row.interval_days)),
      time: row.local_time,
      reminders: Number(row.reminder_count),
      requestLocationAfterMissed: row.request_location_after_missed,
      status: row.status === 'send_failed' ? 'due' : row.status,
      nextCheckIn: row.local_time,
    },
    timezone: row.timezone,
    status: row.status || 'scheduled',
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
    nextRunAt: new Date(row.next_run_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    latestLocation: row.latitude == null ? undefined : {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracy: row.accuracy_meters == null ? undefined : Number(row.accuracy_meters),
      sharedAt: new Date(row.captured_at).toISOString(),
    },
    events: [],
  };
}

function rowToContact(row) {
  return {
    id: row.id,
    name: row.display_name,
    relationship: row.relationship,
    phone: row.phone_e164,
    primary: row.is_primary,
  };
}

function rowToSelfCheckIn(row) {
  if (!row) return null;
  const legacyTimes = Array.isArray(row.reminder_times) && row.reminder_times.length
    ? row.reminder_times
    : [row.local_time].filter(Boolean);
  const legacyWeekdays = Array.isArray(row.weekdays) && row.weekdays.length
    ? row.weekdays.map(Number)
    : [0, 1, 2, 3, 4, 5, 6];
  const reminders = Array.isArray(row.reminders) && row.reminders.length
    ? row.reminders.map((item, index) => ({
        id: String(item.id || `reminder-${index + 1}`),
        time: String(item.time),
        weekdays: Array.isArray(item.weekdays) ? item.weekdays.map(Number) : legacyWeekdays,
      }))
    : legacyTimes.map((time, index) => ({id: `legacy-${index + 1}`, time, weekdays: legacyWeekdays}));
  const times = [...new Set(reminders.map(item => item.time))];
  const weekdays = [...new Set(reminders.flatMap(item => item.weekdays))].sort((a, b) => a - b);
  return {
    id: row.id,
    userId: row.user_id,
    times,
    weekdays,
    reminders,
    time: times[0],
    timezone: row.timezone,
    nextRunAt: new Date(row.next_run_at).toISOString(),
    status: row.status === 'send_failed' ? 'send-failed' : row.status,
    stage: Number(row.stage),
    active: row.active,
    developmentPreview: Boolean(row.development_preview),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
    lastResponseAt: row.last_response_at
      ? new Date(row.last_response_at).toISOString()
      : undefined,
    events: [],
  };
}

function rowToBillingPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    purchaseType: row.purchase_type,
    productId: row.product_id,
    basePlanId: row.base_plan_id || null,
    status: row.status,
    storeTransactionId: row.store_transaction_id,
    originalTransactionId: row.original_transaction_id || null,
    purchaseTokenHash: row.purchase_token_hash,
    purchaseTokenEncrypted: row.purchase_token_encrypted || null,
    currentPeriodEndsAt: row.current_period_ends_at
      ? new Date(row.current_period_ends_at).toISOString()
      : null,
    autoRenewing: Boolean(row.auto_renewing),
    rawStorePayload: row.raw_store_payload || {},
    lastVerifiedAt: row.last_verified_at
      ? new Date(row.last_verified_at).toISOString()
      : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function billingEntitlement(purchases) {
  const now = Date.now();
  const eligible = purchases.filter(item => {
    if (item.purchaseType === 'lifetime') return item.status === 'active';
    const expiresAt = item.currentPeriodEndsAt
      ? new Date(item.currentPeriodEndsAt).getTime()
      : 0;
    return ['active', 'grace_period'].includes(item.status) && expiresAt > now;
  });
  eligible.sort((left, right) => {
    const leftFamilyCapacity = familyCapacityFor(left.productId, left.basePlanId) || 0;
    const rightFamilyCapacity = familyCapacityFor(right.productId, right.basePlanId) || 0;
    if (leftFamilyCapacity !== rightFamilyCapacity) {
      return rightFamilyCapacity - leftFamilyCapacity;
    }
    if (left.purchaseType !== right.purchaseType) {
      return left.purchaseType === 'lifetime' ? -1 : 1;
    }
    return new Date(right.currentPeriodEndsAt || 0).getTime() -
      new Date(left.currentPeriodEndsAt || 0).getTime();
  });
  const current = eligible[0];
  if (!current) {
    return {
      active: false,
      kind: null,
      productId: null,
      basePlanId: null,
      status: 'inactive',
      expiresAt: null,
      willRenew: false,
      accessSource: null,
      familyRole: null,
      familyCapacity: null,
    };
  }
  return {
    active: true,
    kind: current.purchaseType,
    productId: current.productId,
    basePlanId: current.basePlanId,
    status: current.status,
    expiresAt: current.currentPeriodEndsAt,
    willRenew: current.autoRenewing,
    accessSource: 'direct',
    familyRole: isFamilyProduct(current.productId) ? 'owner' : null,
    familyCapacity: familyCapacityFor(current.productId, current.basePlanId),
  };
}

export class DataStore {
  constructor() {
    this.memory = process.env.USE_IN_MEMORY_DB === 'true' || !process.env.DATABASE_URL;
    this.users = new Map();
    this.sessions = new Map();
    this.pushTokens = new Map();
    this.otpChallenges = [];
    this.preferences = new Map();
    this.schedules = new Map();
    this.contacts = new Map();
    this.selfSchedules = new Map();
    this.safetyLocations = new Map();
    this.billingPurchases = new Map();
    this.familyMembers = new Map();
    this.grants = new Map();
    this.safetyAlerts = new Map();
    this.safetyAlertRecipients = new Map();
    this.safetyAlertDeliveries = new Map();
    this.webhooks = new Set();
    if (!this.memory) {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.DATABASE_POOL_SIZE || 5),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
    }
  }

  get mode() {
    return this.memory ? 'memory' : 'postgresql';
  }

  async connect() {
    if (!this.memory) await this.pool.query('SELECT 1');
  }

  async close() {
    if (!this.memory) await this.pool.end();
  }

  async health() {
    if (this.memory) return true;
    await this.pool.query('SELECT 1');
    return true;
  }

  async getOtpRequestState(phone) {
    if (this.memory) {
      const now = Date.now();
      const matching = this.otpChallenges.filter(item => item.phone === phone);
      const latest = matching.reduce(
        (value, item) => Math.max(value, new Date(item.createdAt).getTime()),
        0,
      );
      return {
        lastRequestedAt: latest ? new Date(latest).toISOString() : null,
        requestCountLastHour: matching.filter(
          item => new Date(item.createdAt).getTime() > now - 60 * 60_000,
        ).length,
      };
    }
    const result = await this.pool.query(
      `SELECT max(created_at) AS last_requested_at,
              count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS request_count_last_hour
       FROM otp_challenges WHERE phone_e164 = $1`,
      [phone],
    );
    return {
      lastRequestedAt: result.rows[0].last_requested_at,
      requestCountLastHour: Number(result.rows[0].request_count_last_hour || 0),
    };
  }

  async createOtpChallenge({phone, codeHash, expiresAt}) {
    if (this.memory) {
      const now = new Date().toISOString();
      this.otpChallenges.forEach(item => {
        if (item.phone === phone && !item.consumedAt) item.consumedAt = now;
      });
      const challenge = {
        id: randomUUID(), phone, codeHash, attemptCount: 0, expiresAt,
        consumedAt: null, createdAt: now,
      };
      this.otpChallenges.push(challenge);
      return challenge.id;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE otp_challenges SET consumed_at = now()
         WHERE phone_e164 = $1 AND consumed_at IS NULL`,
        [phone],
      );
      const result = await client.query(
        `INSERT INTO otp_challenges (phone_e164, code_hash, expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [phone, codeHash, expiresAt],
      );
      await client.query('COMMIT');
      return result.rows[0].id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async invalidateOtpChallenge(phone, codeHash) {
    if (this.memory) {
      const challenge = [...this.otpChallenges].reverse().find(
        item => item.phone === phone && item.codeHash === codeHash && !item.consumedAt,
      );
      if (challenge) challenge.consumedAt = new Date().toISOString();
      return;
    }
    await this.pool.query(
      `UPDATE otp_challenges SET consumed_at = now()
       WHERE phone_e164 = $1 AND code_hash = $2 AND consumed_at IS NULL`,
      [phone, codeHash],
    );
  }

  async consumeOtpChallenge({phone, codeHash, maxAttempts}) {
    if (this.memory) {
      const challenge = [...this.otpChallenges].reverse().find(item => item.phone === phone);
      if (!challenge || challenge.consumedAt ||
          new Date(challenge.expiresAt).getTime() <= Date.now() ||
          challenge.attemptCount >= maxAttempts) return false;
      if (challenge.codeHash !== codeHash) {
        challenge.attemptCount += 1;
        return false;
      }
      challenge.consumedAt = new Date().toISOString();
      return true;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT id, code_hash, attempt_count, expires_at, consumed_at
         FROM otp_challenges WHERE phone_e164 = $1
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [phone],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.consumed_at ||
          new Date(challenge.expires_at).getTime() <= Date.now() ||
          Number(challenge.attempt_count) >= maxAttempts) {
        await client.query('COMMIT');
        return false;
      }
      if (challenge.code_hash !== codeHash) {
        await client.query(
          'UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1',
          [challenge.id],
        );
        await client.query('COMMIT');
        return false;
      }
      await client.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [challenge.id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createUserSession({phone, name, tokenHash, expiresAt}) {
    if (this.memory) {
      let user = [...this.users.values()].find(item => item.phone === phone);
      if (!user) {
        user = {id: randomUUID(), phone, name, phoneVerifiedAt: new Date().toISOString()};
        this.users.set(user.id, user);
      } else {
        user.name = name;
        user.phoneVerifiedAt = new Date().toISOString();
      }
      this.sessions.set(tokenHash, {userId: user.id, expiresAt});
      if (!this.preferences.has(user.id)) {
        this.preferences.set(user.id, {
          notifications: true,
          sounds: true,
          vibration: true,
          safetyLocation: false,
        });
      }
      return user;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO users (phone_e164, display_name, phone_verified_at)
         VALUES ($1, $2, now())
         ON CONFLICT (phone_e164) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           phone_verified_at = now(),
           updated_at = now()
         RETURNING id, phone_e164, display_name, phone_verified_at`,
        [phone, name],
      );
      const user = result.rows[0];
      await client.query(
        `INSERT INTO user_preferences (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
      await client.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expiresAt],
      );
      await client.query('COMMIT');
      return {
        id: user.id,
        phone: user.phone_e164,
        name: user.display_name,
        phoneVerifiedAt: user.phone_verified_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async authenticate(tokenHash) {
    if (!tokenHash) return null;
    if (this.memory) {
      const session = this.sessions.get(tokenHash);
      if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
      return this.users.get(session.userId) || null;
    }
    const result = await this.pool.query(
      `UPDATE auth_sessions s SET last_used_at = now()
       FROM users u
       WHERE s.token_hash = $1 AND s.user_id = u.id
         AND s.revoked_at IS NULL AND s.expires_at > now()
       RETURNING u.id, u.phone_e164, u.display_name, u.phone_verified_at`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? {id: row.id, phone: row.phone_e164, name: row.display_name, phoneVerifiedAt: row.phone_verified_at} : null;
  }

  async revokeSession(tokenHash) {
    if (!tokenHash) return false;
    if (this.memory) return this.sessions.delete(tokenHash);
    const result = await this.pool.query(
      `UPDATE auth_sessions SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
    return result.rowCount > 0;
  }

  async upsertPushToken(userId, token, platform) {
    const value = {userId, token, platform, updatedAt: new Date().toISOString()};
    if (this.memory) {
      this.pushTokens.set(token, value);
      return clone(value);
    }
    const result = await this.pool.query(
      `INSERT INTO device_push_tokens (user_id, platform, token, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         updated_at = now()
       RETURNING platform, token, updated_at`,
      [userId, platform, token],
    );
    return {
      platform: result.rows[0].platform,
      token: result.rows[0].token,
      updatedAt: result.rows[0].updated_at,
    };
  }

  async listPushTokens(userId) {
    if (this.memory) {
      return [...this.pushTokens.values()]
        .filter(item => item.userId === userId)
        .map(clone);
    }
    const result = await this.pool.query(
      `SELECT platform, token, updated_at
       FROM device_push_tokens WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    );
    return result.rows.map(row => ({
      platform: row.platform,
      token: row.token,
      updatedAt: row.updated_at,
    }));
  }

  async deletePushToken(userId, token) {
    if (this.memory) {
      const item = this.pushTokens.get(token);
      return Boolean(item?.userId === userId && this.pushTokens.delete(token));
    }
    const result = await this.pool.query(
      'DELETE FROM device_push_tokens WHERE user_id = $1 AND token = $2',
      [userId, token],
    );
    return result.rowCount > 0;
  }

  async deletePushTokensForUser(userId) {
    if (this.memory) {
      let removed = 0;
      for (const [token, item] of this.pushTokens) {
        if (item.userId === userId) {
          this.pushTokens.delete(token);
          removed += 1;
        }
      }
      return removed;
    }
    const result = await this.pool.query(
      'DELETE FROM device_push_tokens WHERE user_id = $1',
      [userId],
    );
    return result.rowCount;
  }

  async upsertBillingPurchase(userId, purchase) {
    const value = {
      id: randomUUID(),
      userId,
      platform: purchase.platform,
      purchaseType: purchase.purchaseType,
      productId: purchase.productId,
      basePlanId: purchase.basePlanId || null,
      status: purchase.status,
      storeTransactionId: purchase.storeTransactionId,
      originalTransactionId: purchase.originalTransactionId || null,
      purchaseTokenHash: purchase.purchaseTokenHash,
      purchaseTokenEncrypted: purchase.purchaseTokenEncrypted || null,
      currentPeriodEndsAt: purchase.currentPeriodEndsAt || null,
      autoRenewing: purchase.autoRenewing === true,
      rawStorePayload: purchase.rawStorePayload || {},
      lastVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (this.memory) {
      const existing = this.billingPurchases.get(value.purchaseTokenHash);
      if (existing && existing.userId !== userId) {
        const error = new Error('This Google Play purchase is already linked to another Din Din account');
        error.code = 'PURCHASE_ALREADY_CLAIMED';
        throw error;
      }
      if (existing) value.id = existing.id;
      this.billingPurchases.set(value.purchaseTokenHash, value);
      return clone(value);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT user_id FROM subscriptions WHERE purchase_token_hash = $1 FOR UPDATE',
        [value.purchaseTokenHash],
      );
      if (existing.rows[0] && existing.rows[0].user_id !== userId) {
        const error = new Error('This Google Play purchase is already linked to another Din Din account');
        error.code = 'PURCHASE_ALREADY_CLAIMED';
        throw error;
      }
      const result = await client.query(
        `INSERT INTO subscriptions
           (user_id, platform, purchase_type, product_id, base_plan_id, status,
            store_transaction_id, original_transaction_id, purchase_token_hash, purchase_token_encrypted,
            current_period_ends_at, auto_renewing, raw_store_payload,
            last_verified_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, now(), now())
         ON CONFLICT (purchase_token_hash) WHERE purchase_token_hash IS NOT NULL DO UPDATE SET
           platform = EXCLUDED.platform,
           purchase_type = EXCLUDED.purchase_type,
           product_id = EXCLUDED.product_id,
           base_plan_id = EXCLUDED.base_plan_id,
           status = EXCLUDED.status,
           store_transaction_id = EXCLUDED.store_transaction_id,
           original_transaction_id = EXCLUDED.original_transaction_id,
           purchase_token_encrypted = EXCLUDED.purchase_token_encrypted,
           current_period_ends_at = EXCLUDED.current_period_ends_at,
           auto_renewing = EXCLUDED.auto_renewing,
           raw_store_payload = EXCLUDED.raw_store_payload,
           last_verified_at = now(),
           updated_at = now()
         RETURNING *`,
        [
          userId,
          value.platform,
          value.purchaseType,
          value.productId,
          value.basePlanId,
          value.status,
          value.storeTransactionId,
          value.originalTransactionId,
          value.purchaseTokenHash,
          value.purchaseTokenEncrypted,
          value.currentPeriodEndsAt,
          value.autoRenewing,
          JSON.stringify(value.rawStorePayload),
        ],
      );
      await client.query('COMMIT');
      return rowToBillingPurchase(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBillingPurchaseByTokenHash(purchaseTokenHash) {
    if (this.memory) return clone(this.billingPurchases.get(purchaseTokenHash) || null);
    const result = await this.pool.query(
      'SELECT * FROM subscriptions WHERE purchase_token_hash = $1',
      [purchaseTokenHash],
    );
    return rowToBillingPurchase(result.rows[0]);
  }

  async getBillingEntitlement(userId) {
    const user = await this.getUser(userId);
    if (!user) return billingEntitlement([]);
    let directPurchases;
    let familyMembership;
    if (this.memory) {
      directPurchases = [...this.billingPurchases.values()].filter(item => item.userId === userId);
      familyMembership = [...this.familyMembers.values()].find(item => item.phone === user.phone) || null;
    } else {
      const [purchaseResult, membershipResult] = await Promise.all([
        this.pool.query(
          `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC`,
          [userId],
        ),
        this.pool.query(
          `SELECT owner_user_id FROM family_members WHERE member_phone_e164 = $1 LIMIT 1`,
          [user.phone],
        ),
      ]);
      directPurchases = purchaseResult.rows.map(rowToBillingPurchase);
      familyMembership = membershipResult.rows[0]
        ? {ownerUserId: membershipResult.rows[0].owner_user_id}
        : null;
    }
    const direct = billingEntitlement(directPurchases);
    if (direct.active || !familyMembership) return direct;

    let ownerPurchases;
    if (this.memory) {
      ownerPurchases = [...this.billingPurchases.values()].filter(
        item => item.userId === familyMembership.ownerUserId && isFamilyProduct(item.productId),
      );
    } else {
      const result = await this.pool.query(
        `SELECT * FROM subscriptions
         WHERE user_id = $1 AND (product_id = 'dindin_family' OR product_id LIKE 'dindin_family_lifetime_%')
         ORDER BY updated_at DESC`,
        [familyMembership.ownerUserId],
      );
      ownerPurchases = result.rows.map(rowToBillingPurchase);
    }
    const inherited = billingEntitlement(ownerPurchases);
    return inherited.active ? {
      ...inherited,
      accessSource: 'family-member',
      familyRole: 'member',
    } : direct;
  }

  async listFamilyMembers(ownerUserId) {
    if (this.memory) {
      return [...this.familyMembers.values()]
        .filter(item => item.ownerUserId === ownerUserId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(clone);
    }
    const result = await this.pool.query(
      `SELECT id, owner_user_id, member_phone_e164, created_at
       FROM family_members WHERE owner_user_id = $1 ORDER BY created_at`,
      [ownerUserId],
    );
    return result.rows.map(row => ({
      id: row.id,
      ownerUserId: row.owner_user_id,
      phone: row.member_phone_e164,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async getFamilyPlan(userId) {
    const user = await this.getUser(userId);
    if (!user) return {role: null, active: false, capacity: 3, members: []};
    const entitlement = await this.getBillingEntitlement(userId);
    const directPurchases = await this.listBillingPurchases(userId);
    const familyPurchases = directPurchases.filter(item => isFamilyProduct(item.productId));
    const ownsFamily = familyPurchases.length > 0;
    if (ownsFamily) {
      const familyEntitlement = billingEntitlement(familyPurchases);
      const historicalCapacity = familyPurchases.reduce(
        (maximum, item) => Math.max(maximum, familyCapacityFor(item.productId, item.basePlanId) || 0),
        3,
      );
      return {
        role: 'owner',
        active: familyEntitlement.active,
        capacity: familyEntitlement.familyCapacity || historicalCapacity,
        members: await this.listFamilyMembers(userId),
      };
    }
    if (entitlement.active && entitlement.familyRole === 'member') {
      return {role: 'member', active: true, capacity: entitlement.familyCapacity || 3, members: []};
    }
    return {role: null, active: false, capacity: 3, members: []};
  }

  async addFamilyMember(ownerUserId, phone, capacity) {
    const owner = await this.getUser(ownerUserId);
    if (!owner) throw Object.assign(new Error('Account not found'), {code: 'ACCOUNT_NOT_FOUND'});
    if (owner.phone === phone) {
      throw Object.assign(new Error('Your own number is already covered by the plan'), {code: 'FAMILY_SELF'});
    }
    if (this.memory) {
      if ([...this.familyMembers.values()].some(item => item.phone === phone)) {
        throw Object.assign(new Error('This number is already assigned to a family plan'), {code: 'FAMILY_PHONE_ASSIGNED'});
      }
      const owned = [...this.familyMembers.values()].filter(item => item.ownerUserId === ownerUserId);
      if (owned.length >= Math.max(0, capacity - 1)) {
        throw Object.assign(new Error(`This ${capacity}-member family plan has no available slots`), {code: 'FAMILY_FULL'});
      }
      const member = {id: randomUUID(), ownerUserId, phone, createdAt: new Date().toISOString()};
      this.familyMembers.set(member.id, member);
      return clone(member);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ownerUserId]);
      const count = await client.query(
        'SELECT count(*) AS count FROM family_members WHERE owner_user_id = $1',
        [ownerUserId],
      );
      if (Number(count.rows[0].count) >= Math.max(0, capacity - 1)) {
        throw Object.assign(new Error(`This ${capacity}-member family plan has no available slots`), {code: 'FAMILY_FULL'});
      }
      const result = await client.query(
        `INSERT INTO family_members (owner_user_id, member_phone_e164)
         VALUES ($1, $2)
         RETURNING id, owner_user_id, member_phone_e164, created_at`,
        [ownerUserId, phone],
      );
      await client.query('COMMIT');
      const row = result.rows[0];
      return {
        id: row.id,
        ownerUserId: row.owner_user_id,
        phone: row.member_phone_e164,
        createdAt: new Date(row.created_at).toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        throw Object.assign(new Error('This number is already assigned to a family plan'), {code: 'FAMILY_PHONE_ASSIGNED'});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listBillingPurchases(userId) {
    if (this.memory) {
      return [...this.billingPurchases.values()]
        .filter(item => item.userId === userId)
        .map(clone);
    }
    const result = await this.pool.query(
      'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId],
    );
    return result.rows.map(rowToBillingPurchase);
  }

  async setBillingPurchaseStatus(purchaseTokenHash, status) {
    if (this.memory) {
      const purchase = this.billingPurchases.get(purchaseTokenHash);
      if (!purchase) return false;
      purchase.status = status;
      purchase.autoRenewing = false;
      purchase.lastVerifiedAt = new Date().toISOString();
      purchase.updatedAt = purchase.lastVerifiedAt;
      return true;
    }
    const result = await this.pool.query(
      `UPDATE subscriptions SET status = $2, auto_renewing = false,
         last_verified_at = now(), updated_at = now()
       WHERE purchase_token_hash = $1`,
      [purchaseTokenHash, status],
    );
    return result.rowCount > 0;
  }

  async getUser(userId) {
    if (this.memory) return this.users.get(userId) || null;
    const result = await this.pool.query(
      'SELECT id, phone_e164, display_name, phone_verified_at, created_at FROM users WHERE id = $1',
      [userId],
    );
    const row = result.rows[0];
    return row ? {id: row.id, phone: row.phone_e164, name: row.display_name, phoneVerifiedAt: row.phone_verified_at, createdAt: row.created_at} : null;
  }

  async updateUser(userId, name) {
    if (this.memory) {
      const user = this.users.get(userId);
      if (!user) return null;
      user.name = name;
      return user;
    }
    const result = await this.pool.query(
      `UPDATE users SET display_name = $2, updated_at = now()
       WHERE id = $1 RETURNING id, phone_e164, display_name, phone_verified_at`,
      [userId, name],
    );
    const row = result.rows[0];
    return row ? {id: row.id, phone: row.phone_e164, name: row.display_name, phoneVerifiedAt: row.phone_verified_at} : null;
  }

  async deleteUser(userId) {
    if (this.memory) {
      const found = this.users.delete(userId);
      for (const [key, session] of this.sessions) if (session.userId === userId) this.sessions.delete(key);
      for (const [key, value] of this.schedules) if (value.ownerUserId === userId) this.schedules.delete(key);
      for (const [key, value] of this.contacts) if (value.ownerUserId === userId) this.contacts.delete(key);
      for (const [key, value] of this.selfSchedules) if (value.userId === userId) this.selfSchedules.delete(key);
      for (const [key, value] of this.pushTokens) if (value.userId === userId) this.pushTokens.delete(key);
      for (const [key, value] of this.billingPurchases) if (value.userId === userId) this.billingPurchases.delete(key);
      for (const [key, value] of this.familyMembers) if (value.ownerUserId === userId) this.familyMembers.delete(key);
      const alertIds = [...this.safetyAlerts.values()]
        .filter(value => value.userId === userId)
        .map(value => value.id);
      for (const alertId of alertIds) this.safetyAlerts.delete(alertId);
      for (const [key, value] of this.safetyAlertRecipients) {
        if (alertIds.includes(value.alertId)) this.safetyAlertRecipients.delete(key);
      }
      for (const [key, value] of this.safetyAlertDeliveries) {
        if (!this.safetyAlertRecipients.has(value.recipientId)) this.safetyAlertDeliveries.delete(key);
      }
      this.safetyLocations.delete(userId);
      return found;
    }
    const result = await this.pool.query('DELETE FROM users WHERE id = $1', [userId]);
    return result.rowCount > 0;
  }

  async getPreferences(userId) {
    if (this.memory) return this.preferences.get(userId) || null;
    const result = await this.pool.query(
      `SELECT notifications, sounds, vibration, safety_location_enabled
       FROM user_preferences WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? {
      notifications: row.notifications,
      sounds: row.sounds,
      vibration: row.vibration,
      safetyLocation: row.safety_location_enabled,
    } : null;
  }

  async savePreferences(userId, preferences) {
    const value = {
      notifications: preferences.notifications !== false,
      sounds: preferences.sounds !== false,
      vibration: preferences.vibration !== false,
      safetyLocation: preferences.safetyLocation === true,
    };
    if (this.memory) {
      this.preferences.set(userId, value);
      return value;
    }
    const result = await this.pool.query(
      `INSERT INTO user_preferences
         (user_id, notifications, sounds, vibration, safety_location_enabled, request_location_after_missed, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, now())
       ON CONFLICT (user_id) DO UPDATE SET
         notifications = EXCLUDED.notifications,
         sounds = EXCLUDED.sounds,
         vibration = EXCLUDED.vibration,
         safety_location_enabled = EXCLUDED.safety_location_enabled,
         updated_at = now()
       RETURNING notifications, sounds, vibration, safety_location_enabled`,
      [userId, value.notifications, value.sounds, value.vibration, value.safetyLocation],
    );
    const row = result.rows[0];
    return {
      notifications: row.notifications,
      sounds: row.sounds,
      vibration: row.vibration,
      safetyLocation: row.safety_location_enabled,
    };
  }

  async saveSafetyLocation(userId, location) {
    const value = {...location};
    if (this.memory) {
      this.safetyLocations.set(userId, value);
      return clone(value);
    }
    const result = await this.pool.query(
      `INSERT INTO user_safety_locations
         (user_id, latitude, longitude, accuracy_meters, captured_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE SET
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         accuracy_meters = EXCLUDED.accuracy_meters,
         captured_at = EXCLUDED.captured_at,
         updated_at = now()
       RETURNING latitude, longitude, accuracy_meters, captured_at`,
      [userId, value.latitude, value.longitude, value.accuracy ?? null, value.capturedAt],
    );
    const row = result.rows[0];
    return {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracy: row.accuracy_meters == null ? undefined : Number(row.accuracy_meters),
      capturedAt: new Date(row.captured_at).toISOString(),
    };
  }

  async getSafetyLocation(userId) {
    if (this.memory) return clone(this.safetyLocations.get(userId) || null);
    const result = await this.pool.query(
      `SELECT latitude, longitude, accuracy_meters, captured_at
       FROM user_safety_locations WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracy: row.accuracy_meters == null ? undefined : Number(row.accuracy_meters),
      capturedAt: new Date(row.captured_at).toISOString(),
    } : null;
  }

  async listContacts(ownerUserId) {
    if (this.memory) {
      return [...this.contacts.values()]
        .filter(item => item.ownerUserId === ownerUserId)
        .map(item => clone({
          id: item.id,
          name: item.name,
          relationship: item.relationship,
          phone: item.phone,
          primary: item.primary,
        }));
    }
    const result = await this.pool.query(
      `SELECT id, display_name, relationship, phone_e164, is_primary
       FROM emergency_contacts WHERE owner_user_id = $1 ORDER BY created_at`,
      [ownerUserId],
    );
    return result.rows.map(rowToContact);
  }

  async createContact(ownerUserId, contact) {
    if (this.memory) {
      const existing = [...this.contacts.values()].find(
        item => item.ownerUserId === ownerUserId && item.phone === contact.phone,
      );
      if (existing) {
        Object.assign(existing, contact);
        return clone({id: existing.id, ...contact});
      }
      const value = {id: randomUUID(), ownerUserId, ...contact};
      this.contacts.set(value.id, value);
      return clone({id: value.id, ...contact});
    }
    const result = await this.pool.query(
      `INSERT INTO emergency_contacts
         (owner_user_id, display_name, relationship, phone_e164, is_primary)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_user_id, phone_e164) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         relationship = EXCLUDED.relationship,
         is_primary = EXCLUDED.is_primary,
         updated_at = now()
       RETURNING id, display_name, relationship, phone_e164, is_primary`,
      [ownerUserId, contact.name, contact.relationship, contact.phone, contact.primary],
    );
    return rowToContact(result.rows[0]);
  }

  async updateContact(contactId, ownerUserId, changes) {
    if (this.memory) {
      const value = this.contacts.get(contactId);
      if (!value || value.ownerUserId !== ownerUserId) return null;
      Object.assign(value, changes);
      return clone({
        id: value.id,
        name: value.name,
        relationship: value.relationship,
        phone: value.phone,
        primary: value.primary,
      });
    }
    const current = await this.pool.query(
      `SELECT id, display_name, relationship, phone_e164, is_primary
       FROM emergency_contacts WHERE id = $1 AND owner_user_id = $2`,
      [contactId, ownerUserId],
    );
    if (!current.rows[0]) return null;
    const value = {
      name: changes.name ?? current.rows[0].display_name,
      relationship: changes.relationship ?? current.rows[0].relationship,
      phone: changes.phone ?? current.rows[0].phone_e164,
      primary: changes.primary ?? current.rows[0].is_primary,
    };
    const result = await this.pool.query(
      `UPDATE emergency_contacts SET
         display_name = $3, relationship = $4, phone_e164 = $5,
         is_primary = $6, updated_at = now()
       WHERE id = $1 AND owner_user_id = $2
       RETURNING id, display_name, relationship, phone_e164, is_primary`,
      [contactId, ownerUserId, value.name, value.relationship, value.phone, value.primary],
    );
    return rowToContact(result.rows[0]);
  }

  async deleteContact(contactId, ownerUserId) {
    if (this.memory) {
      const value = this.contacts.get(contactId);
      return Boolean(value && value.ownerUserId === ownerUserId && this.contacts.delete(contactId));
    }
    const result = await this.pool.query(
      'DELETE FROM emergency_contacts WHERE id = $1 AND owner_user_id = $2',
      [contactId, ownerUserId],
    );
    return result.rowCount > 0;
  }

  async upsertSelfSchedule({userId, reminders, timezone, nextRunAt, developmentPreview = false}) {
    const times = [...new Set(reminders.map(item => item.time))];
    const weekdays = [...new Set(reminders.flatMap(item => item.weekdays))].sort((a, b) => a - b);
    if (this.memory) {
      let value = [...this.selfSchedules.values()].find(item => item.userId === userId);
      if (!value) {
        value = {
          id: randomUUID(), userId, reminders, times, weekdays, time: times[0], timezone, nextRunAt,
          status: 'scheduled', stage: 0, active: true, developmentPreview, events: [],
        };
        this.selfSchedules.set(value.id, value);
      } else {
        Object.assign(value, {
          reminders, times, weekdays, time: times[0], timezone, nextRunAt, status: 'scheduled', stage: 0,
          active: true, developmentPreview, startedAt: undefined,
        });
      }
      return clone(value);
    }
    const result = await this.pool.query(
      `INSERT INTO self_check_in_schedules
         (user_id, timezone, local_time, interval_days, times_per_day,
          intra_day_interval_minutes, reminder_times, weekdays, reminders,
          development_preview, next_run_at, status, stage, active)
       VALUES ($1, $2, $3::time, 1, $4, 0, $5::text[], $6::smallint[], $7::jsonb, $8, $9, 'scheduled', 0, true)
       ON CONFLICT (user_id) DO UPDATE SET
         timezone = EXCLUDED.timezone,
         local_time = EXCLUDED.local_time,
         interval_days = 1,
         times_per_day = EXCLUDED.times_per_day,
         intra_day_interval_minutes = 0,
         reminder_times = EXCLUDED.reminder_times,
         weekdays = EXCLUDED.weekdays,
         reminders = EXCLUDED.reminders,
         development_preview = EXCLUDED.development_preview,
         next_run_at = EXCLUDED.next_run_at,
         status = 'scheduled', stage = 0, active = true,
         started_at = NULL, updated_at = now()
       RETURNING id, user_id, timezone,
         to_char(local_time, 'HH24:MI') AS local_time,
         reminder_times, weekdays, reminders, development_preview,
         active, next_run_at, status, stage,
         started_at, last_response_at`,
      [userId, timezone, times[0], reminders.length, times, weekdays, JSON.stringify(reminders), developmentPreview, nextRunAt],
    );
    return rowToSelfCheckIn(result.rows[0]);
  }

  async getSelfSchedule(userId) {
    if (this.memory) {
      const value = [...this.selfSchedules.values()].find(item => item.userId === userId);
      return value ? clone(value) : null;
    }
    const result = await this.pool.query(this.selfScheduleQuery('user_id = $1'), [userId]);
    return rowToSelfCheckIn(result.rows[0]);
  }

  async deleteSelfSchedule(userId) {
    if (this.memory) {
      const entry = [...this.selfSchedules.entries()].find(([, item]) => item.userId === userId);
      if (!entry) return false;
      const scheduleId = entry[0];
      const alertIds = [...this.safetyAlerts.values()]
        .filter(value => value.scheduleId === scheduleId)
        .map(value => value.id);
      for (const alertId of alertIds) this.safetyAlerts.delete(alertId);
      for (const [key, value] of this.safetyAlertRecipients) {
        if (alertIds.includes(value.alertId)) this.safetyAlertRecipients.delete(key);
      }
      for (const [key, value] of this.safetyAlertDeliveries) {
        if (!this.safetyAlertRecipients.has(value.recipientId)) this.safetyAlertDeliveries.delete(key);
      }
      return this.selfSchedules.delete(scheduleId);
    }
    const result = await this.pool.query(
      'DELETE FROM self_check_in_schedules WHERE user_id = $1',
      [userId],
    );
    return result.rowCount > 0;
  }

  async getSelfScheduleById(scheduleId, ownerUserId = null) {
    if (this.memory) {
      const value = this.selfSchedules.get(scheduleId);
      return value && (!ownerUserId || value.userId === ownerUserId) ? clone(value) : null;
    }
    const where = ownerUserId ? 'id = $1 AND user_id = $2' : 'id = $1';
    const values = ownerUserId ? [scheduleId, ownerUserId] : [scheduleId];
    const result = await this.pool.query(this.selfScheduleQuery(where), values);
    return rowToSelfCheckIn(result.rows[0]);
  }

  async loadActiveSelfSchedules() {
    if (this.memory) return [...this.selfSchedules.values()].filter(item => item.active).map(clone);
    const result = await this.pool.query(this.selfScheduleQuery('active = true'));
    return result.rows.map(rowToSelfCheckIn);
  }

  selfScheduleQuery(where) {
    return `SELECT id, user_id, timezone,
      to_char(local_time, 'HH24:MI') AS local_time,
      reminder_times, weekdays, reminders, development_preview,
      active, next_run_at, status, stage,
      started_at, last_response_at
      FROM self_check_in_schedules WHERE ${where}`;
  }

  async setSelfState(scheduleId, {status, stage, startedAt, lastResponseAt}) {
    if (this.memory) {
      const value = this.selfSchedules.get(scheduleId);
      if (!value) return null;
      value.status = status;
      value.stage = stage;
      if (startedAt !== undefined) value.startedAt = startedAt;
      if (lastResponseAt !== undefined) value.lastResponseAt = lastResponseAt;
      return clone(value);
    }
    const result = await this.pool.query(
      `UPDATE self_check_in_schedules SET
         status = $2, stage = $3,
         started_at = CASE WHEN $4::text IS NULL THEN started_at ELSE $4::timestamptz END,
         last_response_at = CASE WHEN $5::text IS NULL THEN last_response_at ELSE $5::timestamptz END,
         updated_at = now()
       WHERE id = $1
       RETURNING id, user_id, timezone,
         to_char(local_time, 'HH24:MI') AS local_time,
         reminder_times, weekdays, reminders, development_preview,
         active, next_run_at, status, stage,
         started_at, last_response_at`,
      [scheduleId, status === 'send-failed' ? 'send_failed' : status, stage, startedAt ?? null, lastResponseAt ?? null],
    );
    return rowToSelfCheckIn(result.rows[0]);
  }

  async updateSelfNextRun(scheduleId, nextRunAt) {
    if (this.memory) {
      const value = this.selfSchedules.get(scheduleId);
      if (value) value.nextRunAt = nextRunAt;
      return;
    }
    await this.pool.query(
      'UPDATE self_check_in_schedules SET next_run_at = $2, updated_at = now() WHERE id = $1',
      [scheduleId, nextRunAt],
    );
  }

  async setSelfActive(scheduleId, userId, active, nextRunAt, developmentPreview = null) {
    if (this.memory) {
      const value = this.selfSchedules.get(scheduleId);
      if (!value || value.userId !== userId) return null;
      Object.assign(value, {
        active,
        nextRunAt: nextRunAt || value.nextRunAt,
        status: 'scheduled',
        stage: 0,
        startedAt: undefined,
        ...(developmentPreview == null ? {} : {developmentPreview}),
      });
      return clone(value);
    }
    const result = await this.pool.query(
      `UPDATE self_check_in_schedules SET
         active = $3,
         next_run_at = COALESCE($4::timestamptz, next_run_at),
         development_preview = COALESCE($5::boolean, development_preview),
         status = 'scheduled', stage = 0, started_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, timezone,
         to_char(local_time, 'HH24:MI') AS local_time,
         reminder_times, weekdays, reminders, development_preview,
         active, next_run_at, status, stage, started_at, last_response_at`,
      [scheduleId, userId, active, nextRunAt || null, developmentPreview],
    );
    return rowToSelfCheckIn(result.rows[0]);
  }

  async addSelfEvent(schedule, type, details = {}) {
    const event = {type, ...details, at: new Date().toISOString()};
    schedule.events ||= [];
    schedule.events.push(event);
    if (!this.memory) {
      await this.pool.query(
        `INSERT INTO self_check_in_events (schedule_id, event_type, details)
         VALUES ($1, $2, $3::jsonb)`,
        [schedule.id, type, JSON.stringify(details)],
      );
    }
    return event;
  }

  async createSchedule({ownerUserId, relative, timezone, nextRunAt}) {
    if (this.memory) {
      const id = randomUUID();
      const runId = randomUUID();
      const checkIn = {
        id,
        runId,
        ownerUserId,
        relative: {...relative, id: randomUUID()},
        timezone,
        status: 'scheduled',
        nextRunAt,
        createdAt: new Date().toISOString(),
        events: [],
      };
      this.schedules.set(id, checkIn);
      return clone(checkIn);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const relativeResult = await client.query(
        `INSERT INTO relatives (owner_user_id, display_name, relationship, phone_e164)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_user_id, phone_e164) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           relationship = EXCLUDED.relationship,
           updated_at = now()
         RETURNING id`,
        [ownerUserId, relative.name, relative.relationship, relative.phone],
      );
      const relativeId = relativeResult.rows[0].id;
      const scheduleResult = await client.query(
        `INSERT INTO check_in_schedules
           (relative_id, timezone, local_time, interval_days, reminder_count,
            request_location_after_missed, next_run_at)
         VALUES ($1, $2, $3::time, $4, $5, $6, $7)
         RETURNING id, created_at`,
        [relativeId, timezone, relative.time, intervalDays(relative.interval), relative.reminders, relative.requestLocationAfterMissed === true, nextRunAt],
      );
      const schedule = scheduleResult.rows[0];
      const runResult = await client.query(
        `INSERT INTO check_in_runs (schedule_id, status, scheduled_for)
         VALUES ($1, 'scheduled', $2) RETURNING id`,
        [schedule.id, nextRunAt],
      );
      await client.query('COMMIT');
      return {
        id: schedule.id,
        runId: runResult.rows[0].id,
        ownerUserId,
        relative: {...relative, id: relativeId},
        timezone,
        status: 'scheduled',
        nextRunAt,
        createdAt: new Date(schedule.created_at).toISOString(),
        events: [],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listSchedules(ownerUserId) {
    if (this.memory) return [...this.schedules.values()].filter(item => item.ownerUserId === ownerUserId).map(clone);
    const result = await this.pool.query(this.scheduleQuery('r.owner_user_id = $1'), [ownerUserId]);
    return result.rows.map(rowToCheckIn);
  }

  async getSchedule(scheduleId, ownerUserId = null) {
    if (this.memory) {
      const item = this.schedules.get(scheduleId);
      return item && (!ownerUserId || item.ownerUserId === ownerUserId) ? clone(item) : null;
    }
    const values = ownerUserId ? [scheduleId, ownerUserId] : [scheduleId];
    const where = ownerUserId ? 's.id = $1 AND r.owner_user_id = $2' : 's.id = $1';
    const result = await this.pool.query(this.scheduleQuery(where), values);
    return result.rows[0] ? rowToCheckIn(result.rows[0]) : null;
  }

  async loadActiveSchedules() {
    if (this.memory) return [...this.schedules.values()].map(clone);
    const result = await this.pool.query(this.scheduleQuery('s.active = true'));
    return result.rows.map(rowToCheckIn);
  }

  scheduleQuery(where) {
    return `SELECT
      s.id AS schedule_id, s.timezone,
      to_char(s.local_time, 'FMHH12:MI AM') AS local_time,
      s.interval_days, s.reminder_count, s.request_location_after_missed,
      s.next_run_at, s.created_at,
      r.id AS relative_id, r.owner_user_id, r.display_name, r.relationship, r.phone_e164,
      latest_run.id AS run_id, latest_run.started_at,
      COALESCE(latest_run.status, 'scheduled') AS status,
      latest_point.latitude, latest_point.longitude, latest_point.accuracy_meters, latest_point.captured_at
    FROM check_in_schedules s
    JOIN relatives r ON r.id = s.relative_id
    LEFT JOIN LATERAL (
      SELECT cr.id, cr.status, cr.started_at FROM check_in_runs cr
      WHERE cr.schedule_id = s.id ORDER BY cr.created_at DESC LIMIT 1
    ) latest_run ON true
    LEFT JOIN LATERAL (
      SELECT lp.latitude, lp.longitude, lp.accuracy_meters, lp.captured_at
      FROM location_share_grants lg JOIN location_points lp ON lp.grant_id = lg.id
      WHERE lg.check_in_run_id = latest_run.id ORDER BY lp.captured_at DESC LIMIT 1
    ) latest_point ON true
    WHERE ${where}`;
  }

  async beginRun(checkIn) {
    if (this.memory) {
      checkIn.status = 'waiting';
      const stored = this.schedules.get(checkIn.id);
      if (stored) Object.assign(stored, checkIn);
      return checkIn.runId;
    }
    let runId = checkIn.runId;
    const current = runId && await this.pool.query(
      `UPDATE check_in_runs SET status = 'waiting', started_at = now()
       WHERE id = $1 AND status = 'scheduled' RETURNING id`, [runId]);
    if (!current?.rows[0]) {
      const result = await this.pool.query(
        `INSERT INTO check_in_runs (schedule_id, status, scheduled_for, started_at)
         VALUES ($1, 'waiting', $2, now())
         ON CONFLICT (schedule_id, scheduled_for) DO UPDATE SET status = 'waiting', started_at = now()
         RETURNING id`,
        [checkIn.id, checkIn.nextRunAt],
      );
      runId = result.rows[0].id;
    }
    return runId;
  }

  async setRunStatus(checkIn, status) {
    if (this.memory) {
      const stored = this.schedules.get(checkIn.id);
      if (stored) Object.assign(stored, checkIn, {status});
      return;
    }
    if (!checkIn.runId) return;
    const completed = ['safe', 'missed', 'send_failed'].includes(status);
    await this.pool.query(
      `UPDATE check_in_runs SET status = $2,
         responded_at = CASE WHEN $2 = 'safe' THEN now() ELSE responded_at END,
         completed_at = CASE WHEN $3 THEN now() ELSE completed_at END
       WHERE id = $1`,
      [checkIn.runId, status, completed],
    );
  }

  async updateNextRun(scheduleId, nextRunAt) {
    if (this.memory) {
      const stored = this.schedules.get(scheduleId);
      if (stored) stored.nextRunAt = nextRunAt;
      return;
    }
    await this.pool.query(
      'UPDATE check_in_schedules SET next_run_at = $2, updated_at = now() WHERE id = $1',
      [scheduleId, nextRunAt],
    );
  }

  async addEvent(checkIn, type, details = {}, externalMessageId = null, idempotencyKey = null) {
    const event = {type, ...details, at: new Date().toISOString()};
    checkIn.events ||= [];
    checkIn.events.push(event);
    if (this.memory || !checkIn.runId) return event;
    await this.pool.query(
      `INSERT INTO check_in_events
         (check_in_run_id, event_type, external_message_id, idempotency_key, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [checkIn.runId, type, externalMessageId, idempotencyKey, JSON.stringify(details)],
    );
    return event;
  }

  async deleteSchedule(scheduleId, ownerUserId) {
    if (this.memory) {
      const item = this.schedules.get(scheduleId);
      return Boolean(item && item.ownerUserId === ownerUserId && this.schedules.delete(scheduleId));
    }
    const result = await this.pool.query(
      `DELETE FROM check_in_schedules s USING relatives r
       WHERE s.id = $1 AND s.relative_id = r.id AND r.owner_user_id = $2`,
      [scheduleId, ownerUserId],
    );
    return result.rowCount > 0;
  }

  async createLocationGrant(checkIn, tokenHash, expiresAt) {
    if (this.memory) {
      const grant = {id: randomUUID(), scheduleId: checkIn.id, runId: checkIn.runId, expiresAt, points: []};
      this.grants.set(tokenHash, grant);
      return grant;
    }
    if (!checkIn.runId) throw new Error('A check-in run is required for location consent');
    const result = await this.pool.query(
      `INSERT INTO location_share_grants (check_in_run_id, token_hash, expires_at)
       VALUES ($1, $2, $3) RETURNING id`,
      [checkIn.runId, tokenHash, expiresAt],
    );
    return {id: result.rows[0].id, scheduleId: checkIn.id, runId: checkIn.runId, expiresAt};
  }

  async getLocationGrant(tokenHash) {
    if (this.memory) {
      const grant = this.grants.get(tokenHash);
      return grant && new Date(grant.expiresAt).getTime() > Date.now() ? grant : null;
    }
    const result = await this.pool.query(
      `SELECT lg.id, lg.check_in_run_id AS run_id, cr.schedule_id, lg.expires_at
       FROM location_share_grants lg
       JOIN check_in_runs cr ON cr.id = lg.check_in_run_id
       WHERE lg.token_hash = $1 AND lg.expires_at > now() AND lg.revoked_at IS NULL`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? {id: row.id, runId: row.run_id, scheduleId: row.schedule_id, expiresAt: row.expires_at} : null;
  }

  async addLocationPoint(grant, point) {
    if (this.memory) {
      grant.points.push(point);
      return point;
    }
    await this.pool.query(
      `UPDATE location_share_grants SET consented_at = COALESCE(consented_at, now()) WHERE id = $1`,
      [grant.id],
    );
    const result = await this.pool.query(
      `INSERT INTO location_points (grant_id, latitude, longitude, accuracy_meters, captured_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING captured_at`,
      [grant.id, point.latitude, point.longitude, point.accuracy ?? null, point.sharedAt],
    );
    return {...point, sharedAt: new Date(result.rows[0].captured_at).toISOString()};
  }

  async createSafetyAlert({schedule, user, source, location, recipients, expiresAt, initialReminderCount = 0}) {
    const createdAt = new Date().toISOString();
    // Development simulations can be run repeatedly before a future clock
    // occurrence. They must not claim that real occurrence's production lock.
    const occurrenceAt = source === 'development-test'
      ? createdAt
      : new Date(schedule.nextRunAt).toISOString();
    if (this.memory) {
      const existingAlert = [...this.safetyAlerts.values()].find(alert =>
        alert.scheduleId === schedule.id && alert.occurrenceAt === occurrenceAt
      );
      if (existingAlert) {
        const existingRecipientIds = [...this.safetyAlertRecipients.values()]
          .filter(recipient => recipient.alertId === existingAlert.id)
          .map(recipient => recipient.id);
        return {
          alert: clone(existingAlert),
          recipients: await Promise.all(
            existingRecipientIds.map(id => this.getSafetyAlertRecipient(id)),
          ),
          created: false,
        };
      }
      const alert = {
        id: randomUUID(),
        scheduleId: schedule.id,
        userId: user.id,
        occurrenceAt,
        source,
        location: location ? clone(location) : null,
        expiresAt,
        createdAt,
      };
      this.safetyAlerts.set(alert.id, alert);
      const values = recipients.map(contact => {
        const recipient = {
          id: randomUUID(),
          alertId: alert.id,
          contactId: contact.id,
          reminderCount: initialReminderCount,
          deliveryFailureCount: 0,
          nextReminderAt: null,
          acknowledgedAt: null,
          lastTemplateName: null,
          lastMessageId: null,
          lastError: null,
          createdAt,
        };
        this.safetyAlertRecipients.set(recipient.id, recipient);
        return this.getSafetyAlertRecipient(recipient.id);
      });
      return {alert, recipients: await Promise.all(values), created: true};
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const alertResult = await client.query(
        `INSERT INTO safety_alerts
           (schedule_id, user_id, occurrence_at, source, latitude, longitude,
            accuracy_meters, location_captured_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (schedule_id, occurrence_at)
           WHERE occurrence_at IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          schedule.id,
          user.id,
          occurrenceAt,
          source,
          location?.latitude ?? null,
          location?.longitude ?? null,
          location?.accuracy ?? null,
          location?.capturedAt ?? null,
          expiresAt,
        ],
      );
      const wasCreated = alertResult.rowCount > 0;
      let alertId = alertResult.rows[0]?.id;
      const recipientIds = [];
      if (wasCreated) {
        for (const contact of recipients) {
          const result = await client.query(
            `INSERT INTO safety_alert_recipients
               (alert_id, contact_id, reminder_count)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [alertId, contact.id, initialReminderCount],
          );
          recipientIds.push(result.rows[0].id);
        }
      } else {
        const existingAlert = await client.query(
          `SELECT id FROM safety_alerts
           WHERE schedule_id = $1 AND occurrence_at = $2`,
          [schedule.id, occurrenceAt],
        );
        alertId = existingAlert.rows[0]?.id;
        if (!alertId) throw new Error('Could not recover the existing safety alert');
        const existingRecipients = await client.query(
          `SELECT id FROM safety_alert_recipients WHERE alert_id = $1`,
          [alertId],
        );
        recipientIds.push(...existingRecipients.rows.map(row => row.id));
      }
      await client.query('COMMIT');
      return {
        alert: {
          id: alertId,
          scheduleId: schedule.id,
          userId: user.id,
          occurrenceAt,
          source,
          location,
          expiresAt,
          createdAt,
        },
        recipients: await Promise.all(recipientIds.map(id => this.getSafetyAlertRecipient(id))),
        created: wasCreated,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getSafetyAlertRecipient(recipientId) {
    if (this.memory) {
      const recipient = this.safetyAlertRecipients.get(recipientId);
      if (!recipient) return null;
      const alert = this.safetyAlerts.get(recipient.alertId);
      const contact = this.contacts.get(recipient.contactId);
      const user = this.users.get(alert?.userId);
      if (!alert || !contact || !user) return null;
      return clone({
        ...recipient,
        scheduleId: alert.scheduleId,
        source: alert.source,
        expiresAt: alert.expiresAt,
        location: alert.location,
        userId: user.id,
        userName: user.name,
        userPhone: user.phone,
        contactId: contact.id,
        contactName: contact.name,
        contactPhone: contact.phone,
      });
    }
    const result = await this.pool.query(
      `SELECT sar.id, sar.alert_id, sar.contact_id, sar.reminder_count,
              sar.delivery_failure_count, sar.next_reminder_at, sar.acknowledged_at,
              sar.last_template_name, sar.last_message_id, sar.last_error,
              sa.schedule_id, sa.source, sa.expires_at,
              sa.latitude, sa.longitude, sa.accuracy_meters, sa.location_captured_at,
              u.id AS user_id, u.display_name AS user_name, u.phone_e164 AS user_phone,
              ec.display_name AS contact_name, ec.phone_e164 AS contact_phone
       FROM safety_alert_recipients sar
       JOIN safety_alerts sa ON sa.id = sar.alert_id
       JOIN users u ON u.id = sa.user_id
       JOIN emergency_contacts ec ON ec.id = sar.contact_id
       WHERE sar.id = $1`,
      [recipientId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      alertId: row.alert_id,
      contactId: row.contact_id,
      reminderCount: Number(row.reminder_count),
      deliveryFailureCount: Number(row.delivery_failure_count),
      nextReminderAt: row.next_reminder_at ? new Date(row.next_reminder_at).toISOString() : null,
      acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
      lastTemplateName: row.last_template_name,
      lastMessageId: row.last_message_id,
      lastError: row.last_error,
      scheduleId: row.schedule_id,
      source: row.source,
      expiresAt: new Date(row.expires_at).toISOString(),
      location: row.latitude == null ? null : {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracy: row.accuracy_meters == null ? undefined : Number(row.accuracy_meters),
        capturedAt: new Date(row.location_captured_at).toISOString(),
      },
      userId: row.user_id,
      userName: row.user_name,
      userPhone: row.user_phone,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
    };
  }

  async listPendingSafetyAlertRecipients() {
    if (this.memory) {
      const ids = [...this.safetyAlertRecipients.values()]
        .filter(item => item.nextReminderAt && !item.acknowledgedAt)
        .map(item => item.id);
      const values = await Promise.all(ids.map(id => this.getSafetyAlertRecipient(id)));
      return values.filter(item => item && new Date(item.expiresAt).getTime() > Date.now());
    }
    const result = await this.pool.query(
      `SELECT sar.id FROM safety_alert_recipients sar
       JOIN safety_alerts sa ON sa.id = sar.alert_id
       WHERE sar.acknowledged_at IS NULL
         AND sar.next_reminder_at IS NOT NULL
         AND sa.expires_at > now()`,
    );
    const values = await Promise.all(result.rows.map(row => this.getSafetyAlertRecipient(row.id)));
    return values.filter(Boolean);
  }

  async recordSafetyAlertDelivery(recipientId, {
    templateName,
    messageId,
    reminderCount,
    nextReminderAt,
  }) {
    if (this.memory) {
      const value = this.safetyAlertRecipients.get(recipientId);
      if (!value || value.acknowledgedAt) return false;
      Object.assign(value, {
        lastTemplateName: templateName,
        lastMessageId: messageId,
        lastError: null,
        deliveryFailureCount: 0,
        reminderCount,
        nextReminderAt,
      });
      if (messageId) {
        this.safetyAlertDeliveries.set(messageId, {
          recipientId,
          provider: 'techies',
          templateName,
          sentAt: new Date().toISOString(),
        });
      }
      return true;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE safety_alert_recipients SET
           last_template_name = $2,
           last_message_id = $3,
           last_error = NULL,
           delivery_failure_count = 0,
           reminder_count = $4,
           next_reminder_at = $5,
           updated_at = now()
         WHERE id = $1 AND acknowledged_at IS NULL`,
        [recipientId, templateName, messageId, reminderCount, nextReminderAt],
      );
      if (result.rowCount > 0 && messageId) {
        await client.query(
          `INSERT INTO safety_alert_deliveries
             (recipient_id, provider, provider_message_id, template_name)
           VALUES ($1, 'techies', $2, $3)
           ON CONFLICT (provider_message_id) DO NOTHING`,
          [recipientId, messageId, templateName],
        );
      }
      await client.query('COMMIT');
      return result.rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getSafetyAlertRecipientByProviderMessageId(messageId) {
    if (!messageId) return null;
    if (this.memory) {
      const delivery = this.safetyAlertDeliveries.get(messageId);
      return delivery ? this.getSafetyAlertRecipient(delivery.recipientId) : null;
    }
    const result = await this.pool.query(
      `SELECT recipient_id FROM safety_alert_deliveries
       WHERE provider = 'techies' AND provider_message_id = $1`,
      [messageId],
    );
    return result.rows[0]
      ? this.getSafetyAlertRecipient(result.rows[0].recipient_id)
      : null;
  }

  async recordSafetyAlertFailure(recipientId, {templateName, error, nextReminderAt}) {
    if (this.memory) {
      const value = this.safetyAlertRecipients.get(recipientId);
      if (!value || value.acknowledgedAt) return null;
      value.deliveryFailureCount = Math.min(3, value.deliveryFailureCount + 1);
      Object.assign(value, {
        lastTemplateName: templateName,
        lastError: String(error).slice(0, 500),
        nextReminderAt: value.deliveryFailureCount >= 3 ? null : nextReminderAt,
      });
      return value.deliveryFailureCount;
    }
    const result = await this.pool.query(
      `UPDATE safety_alert_recipients SET
         last_template_name = $2,
         last_error = $3,
         delivery_failure_count = LEAST(3, delivery_failure_count + 1),
         next_reminder_at = CASE
           WHEN delivery_failure_count + 1 >= 3 THEN NULL
           ELSE $4::timestamptz
         END,
         updated_at = now()
       WHERE id = $1 AND acknowledged_at IS NULL
       RETURNING delivery_failure_count`,
      [recipientId, templateName, String(error).slice(0, 500), nextReminderAt],
    );
    return result.rows[0] ? Number(result.rows[0].delivery_failure_count) : null;
  }

  async acknowledgeSafetyAlertRecipient(recipientId) {
    if (this.memory) {
      const value = this.safetyAlertRecipients.get(recipientId);
      const alert = value && this.safetyAlerts.get(value.alertId);
      if (!value || !alert || new Date(alert.expiresAt).getTime() <= Date.now()) return null;
      value.acknowledgedAt ||= new Date().toISOString();
      value.nextReminderAt = null;
      return this.getSafetyAlertRecipient(recipientId);
    }
    const result = await this.pool.query(
      `UPDATE safety_alert_recipients sar SET
         acknowledged_at = COALESCE(sar.acknowledged_at, now()),
         next_reminder_at = NULL,
         updated_at = now()
       FROM safety_alerts sa
       WHERE sar.id = $1
         AND sa.id = sar.alert_id
         AND sa.expires_at > now()
       RETURNING sar.id`,
      [recipientId],
    );
    return result.rows[0] ? this.getSafetyAlertRecipient(recipientId) : null;
  }

  async recordWebhook(provider, externalId, payloadHash) {
    const key = `${provider}:${externalId}`;
    if (this.memory) {
      if (this.webhooks.has(key)) return false;
      this.webhooks.add(key);
      return true;
    }
    const result = await this.pool.query(
      `INSERT INTO processed_webhooks (provider, external_event_id, payload_sha256)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [provider, externalId, payloadHash],
    );
    return result.rowCount > 0;
  }
}

export {intervalDays};
