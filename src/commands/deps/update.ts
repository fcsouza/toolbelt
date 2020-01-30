import { flags } from '@oclif/command'
import chalk from 'chalk'
import { diffJson } from 'diff'
import { compose, keys, map, path } from 'ramda'

import { apps } from '../../clients'
import { CustomCommand } from '../../lib/CustomCommand'
import { parseLocator } from '../../locator'
import log from '../../logger'
import { removeNpm } from '../../modules/deps/utils'

const { getDependencies, updateDependencies, updateDependency } = apps

const cleanDeps = compose(keys, removeNpm)

export default class DepsUpdate extends CustomCommand {
  static description = 'Update all workspace dependencies or a specific app@version'

  static examples = []

  static flags = {
    help: flags.help({ char: 'h' }),
    // flag with a value (-n, --name=VALUE)
    name: flags.string({ char: 'n', description: 'name to print' }),
    // flag with no value (-f, --force)
    force: flags.boolean({ char: 'f' }),
  }

  static args = [{ name: 'appId', required: false }]

  async run() {
    const { args, flags } = this.parse(DepsUpdate)

    const appsList = [args.appId]
    try {
      log.debug('Starting update process')
      const previousDeps = await getDependencies()
      let currentDeps
      if (appsList.length === 0) {
        currentDeps = await updateDependencies()
      } else {
        for (const locator of appsList) {
          const { vendor, name, version } = parseLocator(locator)
          if (!name || !version) {
            log.error(`App ${locator} has an invalid app format, please use <vendor>.<name>@<version>`)
          } else {
            try {
              log.debug(`Starting to update ${locator}`)
              await updateDependency(`${vendor}.${name}`, version, vendor)
            } catch (e) {
              log.error(e.message)
              if (path(['response', 'data', 'message'], e)) {
                log.error(e.response.data.message)
              }
            }
          }
        }

        currentDeps = await getDependencies()
      }
      const [cleanPrevDeps, cleanCurrDeps] = map(cleanDeps, [previousDeps, currentDeps])
      const diff = diffJson(cleanPrevDeps, cleanCurrDeps)
      let nAdded = 0
      let nRemoved = 0
      diff.forEach(
        ({ count, value, added, removed }: { count: number; value: string; added: boolean; removed: boolean }) => {
          const color = added ? chalk.green : removed ? chalk.red : chalk.gray
          if (added) {
            nAdded += count
          } else if (removed) {
            nRemoved += count
          }
          process.stdout.write(color(value))
        }
      )
      if (nAdded === 0 && nRemoved === 0) {
        log.info('No dependencies updated')
      } else {
        if (nAdded > 0) {
          log.info('', nAdded, nAdded > 1 ? ' dependencies ' : ' dependency ', chalk.green('added'), ' successfully')
        }
        if (nRemoved > 0) {
          log.info('', nRemoved, nRemoved > 1 ? ' dependencies ' : 'dependency ', chalk.red('removed'), ' successfully')
        }
      }
    } catch (e) {
      log.error(e.message)
      if (path(['response', 'data', 'message'], e)) {
        log.error(e.response.data.message)
      }
    }
  }
}
