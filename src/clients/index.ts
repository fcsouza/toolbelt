import { Apps, Events, InstanceOptions, IOContext, Logger, Registry, Router, Workspaces } from '@vtex/api'
import { getAccount, getToken, getWorkspace } from '../conf'
import * as env from '../env'
import envTimeout from '../timeout'
import userAgent from '../user-agent'
import Billing from './billingClient'
import { Builder } from './Builder'
import { dummyLogger } from './dummyLogger'
import { Rewriter } from './rewriter'

const DEFAULT_TIMEOUT = 15000
const context: IOContext = {
  account: getAccount(),
  authToken: getToken(),
  production: false,
  product: '',
  region: env.region(),
  route: {
    id: '',
    params: {},
  },
  userAgent,
  workspace: getWorkspace() || 'master',
  requestId: '',
  operationId: '',
  logger: dummyLogger,
  platform: '',
}

const clusterHeader = env.cluster() ? { 'x-vtex-upstream-target': env.cluster() } : null

const options = {
  timeout: (envTimeout || DEFAULT_TIMEOUT) as number,
  headers: {
    ...clusterHeader,
  },
}

const interceptor = <T>(client): T =>
  new Proxy(
    {},
    {
      get: (_, name) => () => {
        throw new Error(`Error trying to call ${client}.${name.toString()} before login.`)
      },
    }
  ) as T

const createClients = (customContext: Partial<IOContext> = {}, customOptions: InstanceOptions = {}) => {
  const mergedContext = { ...context, ...customContext }
  const mergedOptions = { ...options, ...customOptions }
  return {
    builder: new Builder(mergedContext, mergedOptions),
    logger: new Logger(mergedContext, mergedOptions),
    registry: new Registry(mergedContext, mergedOptions),
    rewriter: new Rewriter(mergedContext, mergedOptions),
    events: new Events(mergedContext, mergedOptions),
  }
}

const [apps, router, workspaces, logger, events, billing, rewriter] = getToken()
  ? [
      new Apps(context, options),
      new Router(context, options),
      new Workspaces(context, options),
      new Logger(context, { headers: clusterHeader }),
      new Events(context, { headers: clusterHeader }),
      new Billing(context, options),
      new Rewriter(context, options),
    ]
  : [
      interceptor<Apps>('apps'),
      interceptor<Router>('router'),
      interceptor<Workspaces>('workspaces'),
      interceptor<Logger>('logger'),
      interceptor<Events>('events'),
      interceptor<Billing>('billing'),
      interceptor<Rewriter>('rewriter'),
    ]

export { apps, router, workspaces, logger, events, createClients, billing, rewriter }
