import path from 'path'
import { yarnPath } from '../../../modules/utils'
import { manifestSamples } from '../../fixtures/manifests'
import { mockSetupUtils } from './mocks'

const { setPackageJsonByBuilder, esLintrcEditorMock, packageJsonEditorMock } = mockSetupUtils()
jest.mock('child-process-es6-promise', () => {
  return {
    execSync: jest.fn(),
  }
})

// execSync changes the cwd to getAppRoot(), so this is mocked to check this
jest.mock('../../../manifest', () => {
  return {
    getAppRoot: jest.fn().mockReturnValue('app-root'),
  }
})

const { execSync } = jest.requireMock('child-process-es6-promise')
const { setupESLint } = require('../../../modules/setup/setupESLint')

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Yarn is called correctly and .eslintrc is created', () => {
  const checkYarnCall = () => {
    const dependencies = [
      'eslint@^6.7.2',
      'eslint-config-vtex@^11.2.1',
      'eslint-config-vtex-react@^5.1.0',
      '@types/node@^12.12.21',
      'prettier@^1.19.1',
      'typescript@^3.7.3',
    ]

    const yarnInstallation = `${yarnPath} add ${dependencies.join(' ')} --dev`
    expect(execSync).toBeCalledWith(yarnInstallation, {
      cwd: path.resolve('app-root'),
      stdio: 'inherit',
    })
  }

  const checkEsLintrc = () => {
    expect(esLintrcEditorMock.write).toBeCalledWith('.', expect.anything())
  }

  test(`If package.json doesn't have any eslint deps`, async () => {
    const pkg = { devDependencies: { '@types/node': '12.0.0' } }
    setPackageJsonByBuilder({ root: pkg })

    const builders = ['node', 'react']
    await setupESLint(manifestSamples['node4-react3-app'], builders)

    checkYarnCall()
    checkEsLintrc()
  })

  test('If package.json has some eslint deps', async () => {
    const pkg = { devDependencies: { eslint: '^5.15.1' } }
    setPackageJsonByBuilder({ root: pkg })

    const builders = ['node']
    await setupESLint(manifestSamples['node4-app'], builders)

    checkYarnCall()
    checkEsLintrc()
  })

  test('If package.json has all eslint deps', async () => {
    const pkg = {
      devDependencies: {
        eslint: '^6.4.0',
        'eslint-config-vtex': '^11.0.0',
        'eslint-config-vtex-react': '^5.0.1',
        '@types/node': '^12.7.12',
        prettier: '^1.18.2',
        typescript: '^3.5.3',
      },
    }

    setPackageJsonByBuilder({ root: pkg })
    const builders = ['node', 'react']
    await setupESLint(manifestSamples['node4-react3-app'], builders)
    expect(execSync).not.toBeCalled()
    checkEsLintrc()
  })

  it('should add custom config for react builder', async () => {
    const builders = ['react']

    await setupESLint(manifestSamples['react3-app'], builders)
    expect(esLintrcEditorMock.write).toHaveBeenCalledWith(
      'react',
      expect.objectContaining({
        extends: 'vtex-react',
      })
    )
  })

  it('should not install react custom config on node-only app', async () => {
    const builders = ['node']

    await setupESLint(manifestSamples['node4-app'], builders)

    expect(esLintrcEditorMock.write).toHaveBeenCalledTimes(1)
  })

  it('should not crash when no package.json exists in app root', async () => {
    const builders = ['node']

    packageJsonEditorMock.read.mockImplementationOnce(() => {
      const err = new Error('File not found')

      // @ts-ignore
      err.code = 'ENOENT'

      throw err
    })

    await setupESLint(manifestSamples['node4-app'], builders)

    expect(packageJsonEditorMock.write).toHaveBeenCalledTimes(1)
  })

  it('should not replace custom package.json scripts', async () => {
    const builders = ['node']

    const pkg = {
      scripts: {
        lint: 'tsc --noEmit && eslint --ext ts,tsx .',
      },
    }

    setPackageJsonByBuilder({ root: pkg })

    await setupESLint(manifestSamples['node4-app'], builders)

    expect(packageJsonEditorMock.write).toHaveBeenCalledWith(
      '.',
      expect.objectContaining({
        scripts: {
          lint: pkg.scripts.lint,
        },
      })
    )
  })
})
