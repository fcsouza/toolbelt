import { flags } from '@oclif/command'
import chalk from 'chalk'

import { workspaces } from '../../clients'
import { getAccount, getWorkspace } from '../../conf'
import { CommandError, UserCancelledError } from '../../errors'
import { CustomCommand } from '../../lib/CustomCommand'
import log from '../../logger'
import { promptConfirm } from '../../modules/prompts'
import { workspaceUse } from './use'

const { promote, get } = workspaces
const [account, currentWorkspace] = [getAccount(), getWorkspace()]

const checkMaster = (workspace: string) => {
  if (workspace === 'master') {
    throw new CommandError(`It is not possible to promote workspace ${workspace} to master`)
  }
}

const checkPromotable = async (workspace: string) => {
  checkMaster(workspace)
  const meta = await get(account, currentWorkspace)
  if (!meta.production) {
    throw new CommandError(
      `Workspace ${chalk.green(currentWorkspace)} is not a ${chalk.green(
        'production'
      )} workspace\nOnly production workspaces may be promoted\nUse the command ${chalk.blue(
        'vtex workspace create <workspace> --production'
      )} to create a production workspace`
    )
  }
}

const promptPromoteConfirm = (workspace: string): Promise<any> =>
  promptConfirm(`Are you sure you want to promote workspace ${chalk.green(workspace)} to master?`, true).then(
    answer => {
      if (!answer) {
        throw new UserCancelledError()
      }
    }
  )

export default class WorkspacePromote extends CustomCommand {
  static description = 'Promote this workspace to master'

  static examples = []

  static flags = {
    help: flags.help({ char: 'h' }),
  }

  static args = []

  async run() {
    this.parse(WorkspacePromote)

    log.debug('Promoting workspace', currentWorkspace)
    await checkPromotable(currentWorkspace)
    await promptPromoteConfirm(currentWorkspace)
    await promote(account, currentWorkspace)
    log.info(`Workspace ${chalk.green(currentWorkspace)} promoted successfully`)
    await workspaceUse('master')
  }
}