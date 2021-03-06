import { createHash } from 'crypto'
import { readFile, readJson } from 'fs-extra'
import { length, map } from 'ramda'
import { createInterface } from 'readline'

import { rewriter } from '../../clients'
import log from '../../logger'
import { isVerbose } from '../../utils'
import {
  accountAndWorkspace,
  deleteMetainfo,
  MAX_RETRIES,
  METAINFO_FILE,
  progressBar,
  readCSV,
  saveMetainfo,
  sleep,
  splitJsonArray,
  validateInput,
  handleReadError,
  RETRY_INTERVAL_S,
  showGraphQLErrors,
} from './utils'

const DELETES = 'deletes'
const [account, workspace] = accountAndWorkspace

const inputSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
      },
    },
    required: ['from'],
  },
}

const handleDelete = async (csvPath: string) => {
  const fileHash = (await readFile(csvPath)
    .then(data =>
      createHash('md5')
        .update(`${account}_${workspace}_${data}`)
        .digest('hex')
    )
    .catch(handleReadError)) as string
  const metainfo = await readJson(METAINFO_FILE).catch(() => ({}))
  const deletesMetainfo = metainfo[DELETES] || {}
  let counter = deletesMetainfo[fileHash] ? deletesMetainfo[fileHash].counter : 0
  const routes = await readCSV(csvPath)
  validateInput(inputSchema, routes)

  const allPaths = map(({ from }) => from, routes)

  const separatedPaths = splitJsonArray(allPaths)

  const bar = progressBar('Deleting routes...', counter, length(separatedPaths))

  const listener = createInterface({ input: process.stdin, output: process.stdout }).on('SIGINT', () => {
    saveMetainfo(metainfo, DELETES, fileHash, counter)
    console.log('\n')
    process.exit()
  })

  for (const paths of separatedPaths.splice(counter)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await rewriter.deleteRedirects(paths)
    } catch (e) {
      // eslint-disable-next-line no-await-in-loop
      await saveMetainfo(metainfo, 'deletes', fileHash, counter)
      listener.close()
      throw e
    }
    counter++
    bar.tick()
  }

  log.info('Finished!\n')
  listener.close()
  deleteMetainfo(metainfo, DELETES, fileHash)
}

let retryCount = 0
export default async (csvPath: string) => {
  try {
    await handleDelete(csvPath)
  } catch (e) {
    log.error('Error handling delete')
    const maybeGraphQLError = showGraphQLErrors(e)
    if (isVerbose) {
      console.log(e)
    }
    if (retryCount >= MAX_RETRIES || maybeGraphQLError) {
      process.exit()
    }
    log.error(`Retrying in ${RETRY_INTERVAL_S} seconds...`)
    log.info('Press CTRL+C to abort')
    await sleep(RETRY_INTERVAL_S * 1000)
    retryCount++
    await module.exports.default(csvPath)
  }
}
