import { flags } from '@oclif/command'
import chalk from 'chalk'

import { apps } from '../../../clients'
import { getAccount, getWorkspace } from '../../../conf'
import { UserCancelledError } from '../../../errors'
import { CustomCommand } from '../../../lib/CustomCommand'
import { ManifestEditor, ManifestValidator } from '../../../lib/manifest'
import log from '../../../logger'
import { validateAppAction } from '../../../modules/apps/utils'
import { promptConfirm } from '../../../modules/prompts'

const { uninstallApp } = apps

const promptAppUninstall = (appsList: string[]): Promise<void> =>
  promptConfirm(
    `Are you sure you want to uninstall ${appsList.join(', ')} from account ${chalk.blue(
      getAccount()
    )}, workspace ${chalk.green(getWorkspace())}?`
  ).then(answer => {
    if (!answer) {
      throw new UserCancelledError()
    }
  })

const uninstallApps = async (appsList: string[]): Promise<void> => {
  for (const app of appsList) {
    const appName = ManifestValidator.validateApp(app.split('@')[0], true)
    try {
      log.debug('Starting to uninstall app', appName)
      await uninstallApp(appName)
      log.info(`Uninstalled app ${appName} successfully`)
    } catch (e) {
      log.warn(`The following app was not uninstalled: ${appName}`)
      log.error(`${e.response.status}: ${e.response.statusText}. ${e.response.data.message}`)
    }
  }
}

export default class Uninstall extends CustomCommand {
  static description = 'Uninstall an app (defaults to the app in the current directory)'

  static examples = []

  static flags = {
    help: flags.help({ char: 'h' }),
    yes: flags.boolean({ char: 'y', description: 'Auto confirm prompts' }),
  }

  static args = [{ name: 'appName', required: false }]

  async run() {
    const { args, flags } = this.parse(Uninstall)
    const optionalApp = args.appName

    await validateAppAction('uninstall', optionalApp)
    const app = optionalApp || (await ManifestEditor.getManifestEditor()).appLocator
    const appsList = [app]
    const preConfirm = flags.yes

    if (!preConfirm) {
      await promptAppUninstall(appsList)
    }

    log.debug('Uninstalling app' + (appsList.length > 1 ? 's' : '') + `: ${appsList.join(', ')}`)
    return uninstallApps(appsList)
  }
}
