import { send } from '@koishijs/client'
import type { ModelRequestPort } from './port'

export function createKoishiModelRequestPort(): ModelRequestPort {
  return {
    getModelRequestRecords: (input) => send('chatluna-studio/model-request-records', input),
    getModelRequestRecord: (input) => send('chatluna-studio/model-request-record', input),
    getModelRequestTrajectory: (input) => send('chatluna-studio/model-request-trajectory', input),
    getModelRequestFacets: () => send('chatluna-studio/model-request-facets'),
    clearModelRequestRecords: () => send('chatluna-studio/clear-model-request-records'),
  }
}
