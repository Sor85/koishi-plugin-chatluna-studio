import type {
  ClearStudioModelRequestRecordsResult,
  StudioModelRequestDetail,
  StudioModelRequestFacets,
  StudioModelRequestRecordsPage,
  StudioModelRequestTrajectory,
} from '../../src/types'
import type {
  ModelRequestRecordQuery,
  ModelRequestRecordsQuery,
  ModelRequestTrajectoryQuery,
} from './query'

/**
 * 模型请求记录的客户端 seam。与工作区端口分开：它的输入里只有归属范围、游标与记录标识，
 * 而工作区端口的输入里没有模型请求的概念。
 *
 * 筛选下拉的可选值也走这里而不是从已加载的那一页记录里推：那一页只覆盖当前筛选与分页，
 * 用它当清单会让「筛完之后可选项就只剩筛出来的那些」。
 */
export interface ModelRequestPort {
  getModelRequestRecords(input: ModelRequestRecordsQuery): Promise<StudioModelRequestRecordsPage>
  getModelRequestRecord(input: ModelRequestRecordQuery): Promise<StudioModelRequestDetail>
  getModelRequestTrajectory(input: ModelRequestTrajectoryQuery): Promise<StudioModelRequestTrajectory>
  getModelRequestFacets(): Promise<StudioModelRequestFacets>
  clearModelRequestRecords(): Promise<ClearStudioModelRequestRecordsResult>
}

export type ModelRequestPortOperation = keyof ModelRequestPort
