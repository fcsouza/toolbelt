import { flags } from '@oclif/command'
import { createHash } from 'crypto'
import { readFile, readJson, remove, writeFile } from 'fs-extra'
import { Parser } from 'json2csv'
import { resolve } from 'path'
import { compose, concat, difference, isEmpty, length, map, pluck, prop, reduce } from 'ramda'
import { createInterface } from 'readline'
import { rewriter } from '../../clients'
import { RedirectInput } from '../../clients/rewriter'
import log from '../../logger'
import { isVerbose } from '../../utils'
import { CustomCommand } from '../../lib/CustomCommand'
import { redirectsDelete } from './delete'
import {
  accountAndWorkspace,
  deleteMetainfo,
  handleReadError,
  MAX_RETRIES,
  METAINFO_FILE,
  progressBar,
  readCSV,
  RETRY_INTERVAL_S,
  saveMetainfo,
  showGraphQLErrors,
  sleep,
  splitJsonArray,
  validateInput,
} from '../../modules/rewriter/utils'

const IMPORTS = 'imports'
const [account, workspace] = accountAndWorkspace

const inputSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
      },
      to: {
        type: 'string',
      },
      endDate: {
        type: 'string',
      },
      type: {
        type: 'string',
        enum: ['PERMANENT', 'TEMPORARY'],
      },
    },
    additionalProperties: false,
    required: ['from', 'to', 'type'],
  },
}

const handleImport = async (csvPath: string) => {
  const fileHash = (await readFile(csvPath)
    .then(data =>
      createHash('md5')
        .update(`${account}_${workspace}_${data}`)
        .digest('hex')
    )
    .catch(handleReadError)) as string
  const metainfo = await readJson(METAINFO_FILE).catch(() => ({}))
  const importMetainfo = metainfo[IMPORTS] || {}
  let counter = importMetainfo[fileHash] ? importMetainfo[fileHash].counter : 0
  const routes = await readCSV(csvPath)
  validateInput(inputSchema, routes)

  const routesList = splitJsonArray(routes)

  const bar = progressBar('Importing routes...', counter, length(routesList))

  const listener = createInterface({ input: process.stdin, output: process.stdout }).on('SIGINT', () => {
    saveMetainfo(metainfo, IMPORTS, fileHash, counter)
    console.log('\n')
    process.exit()
  })

  await Promise.each(routesList.splice(counter), async (redirects: RedirectInput[]) => {
    try {
      await rewriter.importRedirects(redirects)
    } catch (e) {
      await saveMetainfo(metainfo, IMPORTS, fileHash, counter)
      listener.close()
      throw e
    }
    counter++
    bar.tick()
  })

  log.info('Finished!\n')
  listener.close()
  deleteMetainfo(metainfo, IMPORTS, fileHash)
  return pluck('from', routes)
}

let retryCount = 0

export default class RedirectsImport extends CustomCommand {
  static description = 'Import redirects for the current account and workspace'

  static examples = []

  static flags = {
    help: flags.help({ char: 'h' }),
    reset: flags.boolean({ char: 'r', description: 'Remove all previous redirects', default: false }),
  }

  static args = [{ name: 'csvPath', required: true }]

  async run() {
    const { args, flags } = this.parse(RedirectsImport)
    const reset = flags.reset
    const csvPath = args.csvPath
    let indexedRoutes
    if (reset) {
      const indexFiles = await rewriter.routesIndexFiles().then(prop('routeIndexFiles'))
      const indexFileNames = pluck('fileName', indexFiles) || []
      indexedRoutes = await Promise.mapSeries(indexFileNames, rewriter.routesIndex).then(
        compose<any, any, any>(pluck('id'), reduce(concat, []))
      )
    }
    let importedRoutes
    try {
      importedRoutes = await handleImport(csvPath)
    } catch (e) {
      log.error('Error handling import')
      const maybeGraphQLErrors = showGraphQLErrors(e)
      if (isVerbose) {
        console.log(e)
      }
      if (retryCount >= MAX_RETRIES || maybeGraphQLErrors) {
        process.exit()
      }
      log.error(`Retrying in ${RETRY_INTERVAL_S} seconds...`)
      log.info('Press CTRL+C to abort')
      await sleep(RETRY_INTERVAL_S * 1000)
      retryCount++
      importedRoutes = await module.exports.default(csvPath)
    }
    if (reset) {
      const routesToDelete = difference(indexedRoutes || [], importedRoutes || [])
      if (routesToDelete && !isEmpty(routesToDelete)) {
        const fileName = `.vtex_redirects_to_delete_${Date.now().toString()}.csv`
        const filePath = `./${fileName}`
        log.info('Deleting old redirects...')
        log.info(
          `In case this step fails, run 'vtex redirects delete ${resolve(fileName)}' to finish deleting old redirects.`
        )
        const json2csvParser = new Parser({ fields: ['from'], delimiter: ';', quote: '' })
        const csv = json2csvParser.parse(map(route => ({ from: route }), routesToDelete))
        await writeFile(filePath, csv)
        await redirectsDelete(filePath)
        await remove(filePath)
      }
    }
    return importedRoutes
  }
}
