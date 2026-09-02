import type {
  ClearStudioModelRequestRecordsResult,
  GetStudioModelRequestRecordInput,
  GetStudioModelRequestRecordsInput,
  ListStudioModelRequestRecordsInput,
  StudioModelRequestCapacity,
  StudioModelRequestDetail,
  StudioModelRequestFacets,
  StudioModelRequestListItem,
  StudioModelRequestRecordsPage,
  StudioModelRequestScope,
  StudioModelRequestTrajectory,
} from '../../src/types'

export const MODEL_REQUEST_PAGE_SIZE = 50

/** 列表顶部的范围选择：与契约里的 scope 同名同值，界面文案由视图给出。 */
export type ModelRequestCategory = StudioModelRequestScope['scope']

export type ModelRequestRecordsQuery = ListStudioModelRequestRecordsInput
export type ModelRequestRecordQuery = GetStudioModelRequestRecordInput
export type ModelRequestTrajectoryQuery = GetStudioModelRequestRecordInput & { mode: 'request' | 'conversation' }

export interface ModelRequestRecordsPageState {
  hasMore: boolean
  nextCursor?: number
  nextCreatedAt?: string
  nextId?: string
  earliestCursor?: number
  capacity: StudioModelRequestCapacity
}

export const emptyModelRequestCapacity: StudioModelRequestCapacity = {
  recordCount: 0,
  totalBytes: 0,
  maxRecords: 500,
  maxBytes: 50 * 1024 * 1024,
}

export const emptyModelRequestRecordsPage: StudioModelRequestRecordsPage = {
  records: [],
  hasMore: false,
  capacity: emptyModelRequestCapacity,
}

export const emptyModelRequestFacets: StudioModelRequestFacets = {
  bots: [],
  conversations: [],
  models: [],
}

export function createModelRequestRecordsQuery(
  category: ModelRequestCategory,
  input: GetStudioModelRequestRecordsInput = {},
): ModelRequestRecordsQuery {
  return { scope: category, ...input, limit: input.limit ?? MODEL_REQUEST_PAGE_SIZE }
}

export type {
  ClearStudioModelRequestRecordsResult,
  StudioModelRequestDetail,
  StudioModelRequestFacets,
  StudioModelRequestListItem,
  StudioModelRequestRecordsPage,
  StudioModelRequestScope,
  StudioModelRequestTrajectory,
}
