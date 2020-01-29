import { flags } from '@oclif/command'
import chalk from 'chalk'

import { createClients } from '../../clients'
import { getAccount, getToken, getWorkspace } from '../../conf'
import { UserCancelledError } from '../../errors'
import { CustomCommand } from '../../lib/CustomCommand'
import { ManifestEditor, ManifestValidator } from '../../lib/manifest'
import { parseLocator } from '../../locator'
import log from '../../logger'
import { switchAccountMessage } from '../../modules/apps/utils'
import { switchAccount } from '../auth/switch'
import { promptConfirm } from '../../modules/prompts'

let originalAccount
let originalWorkspace

const switchToVendorMessage = (vendor: string): string => {
  return `You are trying to undeprecate this app in an account that differs from the indicated vendor. Do you want to undeprecate in account ${chalk.blue(
    vendor
  )}?`
}

const promptUndeprecate = (appsList: string[]) =>
  promptConfirm(
    `Are you sure you want to undeprecate app` +
      (appsList.length > 1 ? 's' : '') +
      ` ${chalk.green(appsList.join(', '))}?`
  )

const promptUndeprecateOnVendor = (msg: string) => promptConfirm(msg)

const switchToPreviousAccount = async (previousAccount: string, previousWorkspace: string) => {
  const currentAccount = getAccount()
  if (previousAccount !== currentAccount) {
    const canSwitchToPrevious = await promptUndeprecateOnVendor(switchAccountMessage(previousAccount, currentAccount))
    if (canSwitchToPrevious) {
      await switchAccount(previousAccount, previousWorkspace)
      return
    }
  }
  return
}

const undeprecateApp = async (app: string): Promise<void> => {
  const { vendor, name, version } = parseLocator(app)
  const account = getAccount()
  if (vendor !== account) {
    const canSwitchToVendor = await promptUndeprecateOnVendor(switchToVendorMessage(vendor))
    if (!canSwitchToVendor) {
      throw new UserCancelledError()
    }
    await switchAccount(vendor, 'master')
  }

  const context = { account: vendor, workspace: 'master', authToken: getToken() }
  const { registry } = createClients(context)
  return await registry.undeprecateApp(`${vendor}.${name}`, version)
}

const prepareUndeprecate = async (appsList: string[]): Promise<void> => {
  for (const app of appsList) {
    ManifestValidator.validateApp(app)
    try {
      log.debug('Starting to undeprecate app:', app)
      await undeprecateApp(app)
      log.info('Successfully undeprecated', app)
    } catch (e) {
      if (e.response && e.response.status && e.response.status === 404) {
        log.error(`Error undeprecating ${app}. App not found`)
      } else if (e.message && e.response.statusText) {
        log.error(`Error undeprecating ${app}. ${e.message}. ${e.response.statusText}`)
        await switchToPreviousAccount(originalAccount, originalWorkspace)
        return
      } else {
        await switchToPreviousAccount(originalAccount, originalWorkspace)
        throw e
      }
    }
  }
}

export default class Undeprecate extends CustomCommand {
  static description = 'Undeprecate app'

  static examples = []

  static flags = {
    help: flags.help({ char: 'h' }),
    yes: flags.boolean({ description: 'Confirm all prompts', char: 'y', default: false }),
  }

  static args = [{ name: 'appId', required: true }]

  async run() {
    const { args, flags } = this.parse(Undeprecate)
    const preConfirm = flags.yes
    const optionalApp = args.appId

    originalAccount = getAccount()
    originalWorkspace = getWorkspace()
    const appsList = [optionalApp || (await ManifestEditor.getManifestEditor()).appLocator]

    if (!preConfirm && !(await promptUndeprecate(appsList))) {
      throw new UserCancelledError()
    }
    log.debug(`Undeprecating app ${appsList.length > 1 ? 's' : ''} : ${appsList.join(', ')}`)
    return prepareUndeprecate(appsList)
  }
}
