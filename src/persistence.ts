import type { Context } from 'koishi'
import type {
  StudioModelRequestAttribution,
  StudioModelRequestRecord,
  StudioModelRequestStatus,
} from './types'
import {
  InMemoryModelRequestRecords,
  toModelRequestRecordHeader,
  type StudioModelRequestPersistence,
  type StudioModelRequestPersistenceQuery,
  type StudioModelRequestRecordHeader,
  type StudioModelRequestScopeSummary,
} from './model-request'
import { ScopeRowIndex } from './record-store'

/** 记录里唯一没有上限的两个字段；列表读取从不投影它们。 */
export interface StudioModelRequestRecordBodies {
  requestBody?: unknown
  responseBodyRaw?: string
}

/**
 * 记录库状态行：只保存 nextSequence 高水位，永远只有一行。
 *
 * 记录条数与字节数由记录行的 bytes 列现算，避免计数漂移；序号必须独立保存，否则清空记录后
 * max(sequence)+1 会回退并复用旧序号，而列表游标正是按序号翻页的。
 */
export interface StudioModelRequestStateRow {
  id: string
  nextSequence: number
  updatedAt: Date
}

/**
 * 一条模型请求记录一行。
 *
 * 记录被拆成两列：`header` 是列表读取需要的全部字段，`bodies` 只装请求体与响应原文。
 * 这两个字段是记录里唯一没有上限的部分，单列存放时列表读取会连它们一起取出并反序列化；
 * 拆列之后列表查询只投影 `header`，翻页与自动刷新不再按请求体体积付代价。
 */
export interface StudioModelRequestRecordRow {
  sequence: number
  id: string
  createdAt: string
  attribution: StudioModelRequestAttribution
  botId: string
  conversationId: string
  interactionId: string
  model: string
  status: StudioModelRequestStatus
  bytes: number
  header: StudioModelRequestRecordHeader
  bodies: StudioModelRequestRecordBodies
}

declare module '@koishijs/core' {
  interface Tables {
    'chatluna-studio.model-request': StudioModelRequestRecordRow
    'chatluna-studio.model-request-state': StudioModelRequestStateRow
  }
}

// 表名使用 "chatluna-studio." 前缀：dataview-next 等工具按点号前缀归属插件；
// ctx.inject 回调里的 model.extend 拿不到插件运行时名称，仅靠上下文会被归为未知来源。
const MODEL_REQUEST_RECORD_TABLE = 'chatluna-studio.model-request'
const MODEL_REQUEST_STATE_TABLE = 'chatluna-studio.model-request-state'
/** 状态表只有一行；固定主键让 upsert 不必先查再写。 */
const MODEL_REQUEST_STATE_ID = 'main'

type StudioRecordRowQuery = Record<string, unknown>

interface StudioRecordRowCursor {
  limit?: number
  offset?: number
  fields?: string[]
  sort?: Record<string, 'asc' | 'desc'>
}

export interface StudioModelRequestDatabase {
  get(table: 'chatluna-studio.model-request', query: StudioRecordRowQuery, cursor?: StudioRecordRowCursor): Promise<StudioModelRequestRecordRow[]>
  get(table: 'chatluna-studio.model-request-state', query: { id: string }): Promise<StudioModelRequestStateRow[]>
  upsert(table: 'chatluna-studio.model-request', rows: StudioModelRequestRecordRow[]): Promise<unknown>
  upsert(table: 'chatluna-studio.model-request-state', rows: StudioModelRequestStateRow[]): Promise<unknown>
  remove(table: 'chatluna-studio.model-request', query: StudioRecordRowQuery): Promise<unknown>
}

/** database 是可选服务，且 Minato 的注册晚于 ready；所有首次读取都要给它这段等待窗口。 */
const DATABASE_READY_TIMEOUT_MS = 10_000

async function waitForDatabase<T>(resolveDatabase: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  let database = resolveDatabase()
  while (!database && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))))
    database = resolveDatabase()
  }
  return database
}

export function registerStudioModelRequestModel(ctx: Context): void {
  // 主键是单调序号：追加、单行更新与按区间回收都只命中自己那一行。
  ctx.model.extend(MODEL_REQUEST_RECORD_TABLE, {
    sequence: 'unsigned',
    id: 'string(64)',
    createdAt: 'string(64)',
    attribution: 'string(16)',
    botId: 'string(64)',
    conversationId: 'string(255)',
    interactionId: 'string(64)',
    model: 'string(255)',
    status: 'string(32)',
    bytes: 'unsigned',
    header: 'json',
    bodies: 'json',
  }, { primary: 'sequence' })
  ctx.model.extend(MODEL_REQUEST_STATE_TABLE, {
    id: 'string(32)',
    nextSequence: 'unsigned',
    updatedAt: 'timestamp',
  }, { primary: 'id' })
}

/** 倒序向更早翻页、正序向更晚翻页；两个适配器的序号游标语义必须一致。 */
function sequenceCursorCondition(order: 'asc' | 'desc', beforeSequence: number) {
  return order === 'asc' ? { $gt: beforeSequence } : { $lt: beforeSequence }
}

/** 把拆列存放的记录头与正文合回一条完整记录。缺省的正文字段不会变成显式 undefined。 */
function fromModelRequestRow(row: StudioModelRequestRecordRow): StudioModelRequestRecord {
  return structuredClone({ ...row.header, ...row.bodies ?? {} })
}

/**
 * 行是否可读。
 *
 * 记录头与正文拆列之前，整条记录存在单独一列里；那些行在新结构下读不出记录身份。
 * 这里直接丢弃它们，而不是重建旧列：模型请求记录是本地验证证据，不承担跨结构迁移。
 */
function isReadableModelRequestRow(row: Pick<StudioModelRequestRecordRow, 'header'>): boolean {
  return Boolean(row.header && typeof row.header === 'object' && typeof row.header.id === 'string')
}

export class KoishiDatabaseModelRequestPersistence implements StudioModelRequestPersistence {
  private index = new ScopeRowIndex()

  constructor(
    private getDatabase: () => StudioModelRequestDatabase | undefined,
    private readyTimeoutMs = DATABASE_READY_TIMEOUT_MS,
  ) {}

  async summarize(): Promise<StudioModelRequestScopeSummary> {
    // database 是可选服务，Minato 可能在本插件构造 Store 后才完成注册。这里等待服务，
    // 不能把"尚未可用"伪装成空库，否则重启后的首次请求会与全部历史记录撞号。
    const database = await waitForDatabase(this.getDatabase, this.readyTimeoutMs)
    if (!database) throw new Error(`等待 Koishi Database 服务 ${this.readyTimeoutMs}ms 后仍不可用`)
    const [state] = await database.get(MODEL_REQUEST_STATE_TABLE, { id: MODEL_REQUEST_STATE_ID })
    const rows = await database.get(MODEL_REQUEST_RECORD_TABLE, {}, {
      fields: ['sequence', 'bytes'],
      sort: { sequence: 'asc' },
    })
    this.index.reset(rows, Number(state?.nextSequence) || 1)
    return this.index.summary()
  }

  async append(record: StudioModelRequestRecord, bytes: number, nextSequence: number) {
    const database = this.requireDatabase()
    await database.upsert(MODEL_REQUEST_RECORD_TABLE, [this.toRow(record, bytes)])
    this.index.put(record.sequence, bytes, nextSequence)
    await this.saveState(database)
    return this.index.summary()
  }

  async find(recordId: string) {
    const database = this.requireDatabase()
    const [row] = await database.get(MODEL_REQUEST_RECORD_TABLE, { id: recordId }, { limit: 1 })
    return row && isReadableModelRequestRow(row) ? fromModelRequestRow(row) : undefined
  }

  async replace(record: StudioModelRequestRecord, bytes: number) {
    const database = this.requireDatabase()
    // 只有仍然存在的行才回写；否则容量回收删掉的记录会被 update 复活。
    if (this.index.has(record.sequence)) {
      await database.upsert(MODEL_REQUEST_RECORD_TABLE, [this.toRow(record, bytes)])
      this.index.put(record.sequence, bytes)
    }
    return this.index.summary()
  }

  async query(query: StudioModelRequestPersistenceQuery) {
    const database = this.requireDatabase()
    const rows = await database.get(MODEL_REQUEST_RECORD_TABLE, this.toRowQuery(query), {
      sort: { sequence: query.order },
      limit: Math.max(0, query.limit),
    })
    return rows.filter(isReadableModelRequestRow).map((row) => fromModelRequestRow(row))
  }

  async queryHeaders(query: StudioModelRequestPersistenceQuery) {
    const database = this.requireDatabase()
    // 只投影记录头：请求体与响应原文留在存储里，驱动不必反序列化它们，也不必跨进程搬运。
    // sequence 一并选出，排序列必须在投影里。
    const rows = await database.get(MODEL_REQUEST_RECORD_TABLE, this.toRowQuery(query), {
      fields: ['sequence', 'header'],
      sort: { sequence: query.order },
      limit: Math.max(0, query.limit),
    })
    return rows.filter(isReadableModelRequestRow).map((row) => structuredClone(row.header))
  }

  async reclaim(limits: { maxRecords: number, maxBytes: number }) {
    const database = this.requireDatabase()
    const cutoff = this.index.resolveCutoff(limits)
    if (cutoff !== undefined) {
      await database.remove(MODEL_REQUEST_RECORD_TABLE, { sequence: { $lte: cutoff } })
      this.index.dropThrough(cutoff)
    }
    return this.index.summary()
  }

  async clear(nextSequence: number) {
    const database = this.requireDatabase()
    await database.remove(MODEL_REQUEST_RECORD_TABLE, {})
    this.index.clear(nextSequence)
    await this.saveState(database)
    return this.index.summary()
  }

  private toRow(record: StudioModelRequestRecord, bytes: number): StudioModelRequestRecordRow {
    return {
      sequence: record.sequence,
      id: record.id,
      createdAt: record.createdAt,
      attribution: record.attribution,
      // 缺省值写空串而不是 undefined：Minato 会丢弃 undefined 字段，过滤条件也就无法判定"未设置"。
      botId: record.entities.botId ?? '',
      conversationId: record.entities.conversationId ?? '',
      interactionId: record.interactionId ?? '',
      model: record.model ?? '',
      status: record.status,
      bytes,
      header: structuredClone(toModelRequestRecordHeader(record)),
      bodies: structuredClone({
        ...(record.requestBody !== undefined ? { requestBody: record.requestBody } : {}),
        ...(record.responseBodyRaw !== undefined ? { responseBodyRaw: record.responseBodyRaw } : {}),
      }),
    }
  }

  private toRowQuery(query: StudioModelRequestPersistenceQuery): StudioRecordRowQuery {
    const rowQuery: StudioRecordRowQuery = {}
    if (query.attribution) rowQuery.attribution = query.attribution
    if (query.botId) rowQuery.botId = query.botId
    if (query.conversationId) rowQuery.conversationId = query.conversationId
    if (query.interactionId) rowQuery.interactionId = query.interactionId
    if (query.model) rowQuery.model = query.model
    if (query.errorsOnly) rowQuery.status = 'error'
    if (query.beforeSequence !== undefined) {
      rowQuery.sequence = sequenceCursorCondition(query.order, query.beforeSequence)
    } else if (query.beforeCreatedAt) {
      // createdAt 是 ISO 8601，字节序等于时间序；同刻并列时才用 id 决胜，
      // 此时的字符串比较由驱动排序规则决定，与内存侧的 localeCompare 只在同刻同前缀时可能不同。
      const strict = query.order === 'asc' ? { $gt: query.beforeCreatedAt } : { $lt: query.beforeCreatedAt }
      if (query.beforeId) {
        rowQuery.$or = [
          { createdAt: strict },
          { createdAt: query.beforeCreatedAt, id: query.order === 'asc' ? { $gt: query.beforeId } : { $lt: query.beforeId } },
        ]
      } else {
        rowQuery.createdAt = query.order === 'asc'
          ? { $gte: query.beforeCreatedAt }
          : { $lte: query.beforeCreatedAt }
      }
    }
    return rowQuery
  }

  private async saveState(database: StudioModelRequestDatabase) {
    await database.upsert(MODEL_REQUEST_STATE_TABLE, [{
      id: MODEL_REQUEST_STATE_ID,
      nextSequence: this.index.readNextSequence(),
      updatedAt: new Date(),
    }])
  }

  private requireDatabase(): StudioModelRequestDatabase {
    const database = this.getDatabase()
    if (!database) throw new Error('Koishi Database 服务不可用，模型请求记录未能落盘')
    return database
  }
}

