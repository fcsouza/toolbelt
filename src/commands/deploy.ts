import { flags } from '@oclif/command'
import chalk from 'chalk'

import { createClients } from '../clients'
import { getAccount, getToken, getWorkspace } from '../conf'
import { UserCancelledError } from '../errors'
import { CustomCommand } from '../lib/CustomCommand'
import { ManifestValidator } from '../lib/manifest'
import { parseLocator, toAppLocator } from '../locator'
import log from '../logger'
import { getManifest } from '../manifest'
import { switchAccountMessage } from '../modules/apps/utils'
import { promptConfirm } from '../modules/prompts'
import { switchAccount } from './switch'

const switchToVendorMessage = (vendor: string): string => {
  return `You are trying to deploy this app in an account that differs from the indicated vendor. Do you want to deploy in account ${chalk.blue(
    vendor
  )}?`
}

const promptDeploy = (app: string) => promptConfirm(`Are you sure you want to deploy app ${app}`)

const switchToPreviousAccount = async (previousAccount: string, previousWorkspace: string) => {
  const currentAccount = getAccount()
  if (previousAccount !== currentAccount) {
    const canSwitchToPrevious = await promptConfirm(switchAccountMessage(previousAccount, currentAccount))
    if (canSwitchToPrevious) {
      return await switchAccount(previousAccount, previousWorkspace)
    }
  }
  return
}

const deployRelease = async (app: string): Promise<void> => {
  const { vendor, name, version } = parseLocator(app)
  const account = getAccount()
  if (vendor !== account) {
    const canSwitchToVendor = await promptConfirm(switchToVendorMessage(vendor))
    if (!canSwitchToVendor) {
      throw new UserCancelledError()
    }
    await switchAccount(vendor, 'master')
  }
  const context = { account: vendor, workspace: 'master', authToken: getToken() }
  const { registry } = createClients(context)
  return await registry.validateApp(`${vendor}.${name}`, version)
}

const prepareDeploy = async (app, originalAccount, originalWorkspace: string): Promise<void> => {
  app = await ManifestValidator.validateApp(app)
  try {
    log.debug('Starting to deploy app:', app)
    await deployRelease(app)
    log.info('Successfully deployed', app)
  } catch (e) {
    if (e?.response?.status === 404) {
      log.error(`Error deploying ${app}. App not found or already deployed`)
    } else if (e.message && e.response.statusText) {
      log.error(`Error deploying ${app}. ${e.message}. ${e.response.statusText}`)
      return await switchToPreviousAccount(originalAccount, originalWorkspace)
    } else {
      await switchToPreviousAccount(originalAccount, originalWorkspace)
      throw e
    }
  }
  await switchToPreviousAccount(originalAccount, originalWorkspace)
}

export default class Deploy extends CustomCommand {
  static description = 'Deploy a release of an app'

  static examples = []

  static flags = {
    help: flags.help({ char: 'h' }),
    yes: flags.boolean({ char: 'y', description: 'Answer yes to confirmation prompts' }),
  }

  static args = [{ name: 'appId', required: true }]

  async run() {
    const {
      args: { appId: optionalApp },
      flags,
    } = this.parse(Deploy)

    const preConfirm = flags.yes
    const originalAccount = getAccount()
    const originalWorkspace = getWorkspace()
    const app = optionalApp || toAppLocator(await getManifest())

    if (!preConfirm && !(await promptDeploy(app))) {
      throw new UserCancelledError()
    }
    log.debug(`Deploying app ${app}`)
    return prepareDeploy(app, originalAccount, originalWorkspace)
  }
}
