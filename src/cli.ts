#!/usr/bin/env node
import os from 'os'

import axios from 'axios'
import chalk from 'chalk'
import { CommandNotFoundError, MissingRequiredArgsError } from 'findhelp'
import semver from 'semver'

import 'v8-compile-cache'
import pkg from '../package.json'
import * as conf from './conf'
import { getToken } from './conf'
import { envCookies } from './env'
import { CommandError, SSEConnectionError, UserCancelledError } from './errors'
import log from './logger'
import { checkAndOpenNPSLink } from './nps'
import { Token } from './Token.js'
import notify from './update'

const nodeVersion = process.version.replace('v', '')
if (!semver.satisfies(nodeVersion, pkg.engines.node)) {
  const minMajor = pkg.engines.node.replace('>=', '')
  console.error(
    chalk.bold(`Incompatible with node < v${minMajor}. Please upgrade node to major ${minMajor} or higher.`)
  )
  process.exit(1)
}

axios.interceptors.request.use(config => {
  if (envCookies()) {
    config.headers.Cookie = `${envCookies()}; ${config.headers.Cookie || ''}`
  }
  return config
})

let loginPending = false

if (process.env.NODE_ENV === 'development') {
  try {
    require('longjohn') // tslint:disable-line
  } catch (e) {
    log.debug("Couldn't require longjohn. If you want long stack traces, run: npm install -g longjohn")
  }
}

// Show update notification if newer version is available
notify()

const logToolbeltVersion = () => {
  log.debug(`Toolbelt version: ${pkg.version}`)
}

const checkLogin = args => {
  const first = args[0]
  const whitelist = [undefined, 'config', 'login', 'logout', 'switch', 'whoami', 'init', '-v', '--version', 'release']
  const token = new Token(getToken())
  if (!token.isValid() && whitelist.indexOf(first) === -1) {
    log.debug('Requesting login before command:', args.join(' '))
    // rodar login!
  }
}

const main = async () => {
  const args = process.argv.slice(2)
  conf.saveEnvironment(conf.Environment.Production) // Just to be backwards compatible with who used staging previously

  logToolbeltVersion()
  log.debug('node %s - %s %s', process.version, os.platform(), os.release())
  log.debug(args)

  await checkLogin(args)

  // rodar comando
  // se verbose rodar o whoami

  await checkAndOpenNPSLink()
}

const onError = e => {
  const status = e?.response?.status
  const statusText = e?.response?.statusText
  const headers = e?.response?.headers
  const data = e?.response?.data
  const code = e?.code || null

  if (headers) {
    log.debug('Failed request headers:', headers)
  }

  if (status) {
    if (status === 401) {
      if (!loginPending) {
        log.error('There was an authentication error. Please login again')
        // Try to login and re-issue the command.
        loginPending = true
        // return run({ command: loginCmd })
        //   .tap(clearCachedModules)
        //   .then(main) // TODO: catch with different handler for second error
      } else {
        return // Prevent multiple login attempts
      }
    }

    if (status >= 400) {
      const message = data ? data.message : null
      const source = e.config.url
      log.error('API:', status, statusText)
      log.error('Source:', source)
      if (e.config?.method) {
        log.error('Method:', e.config.method)
      }

      if (message) {
        log.error('Message:', message)
        log.debug('Raw error:', data)
      } else {
        log.error('Raw error:', {
          data,
          source,
        })
      }
    } else {
      log.error('Oops! There was an unexpected error:')
      log.error(e.read ? e.read().toString('utf8') : data)
    }
  } else if (code) {
    switch (code) {
      case 'ENOTFOUND':
        log.error('Connection failure :(')
        log.error('Please check your internet')
        break
      case 'EAI_AGAIN':
        log.error('A temporary failure in name resolution occurred :(')
        break
      default:
        log.error('Unhandled exception')
        log.error('Please report the issue in https://github.com/vtex/toolbelt/issues')
        if (e.config?.url && e.config?.method) {
          log.error(`${e.config.method} ${e.config.url}`)
        }
        log.debug(e)
    }
  } else {
    switch (e.name) {
      case MissingRequiredArgsError.name:
        log.error('Missing required arguments:', chalk.blue(e.message))
        break
      case CommandNotFoundError.name:
        log.error('Command not found:', chalk.blue(...process.argv.slice(2)))
        break
      case CommandError.name:
        if (e.message && e.message !== '') {
          log.error(e.message)
        }
        break
      case SSEConnectionError.name:
        log.error(e.message ?? 'Connection to login server has failed')
        break
      case UserCancelledError.name:
        log.debug('User Cancelled')
        break
      default:
        log.error('Unhandled exception')
        log.error('Please report the issue in https://github.com/vtex/toolbelt/issues')
        log.error('Raw error:', e)
    }
  }

  process.exit(1)
}

process.on('unhandledRejection', onError)
